"""
ERP React - Accounting Router
Journal entries, general ledger, chart of accounts, financial statements.
Based on comptabilite.py (9,658 lines) + grand_livre.py + etats_financiers.py.
"""

import os
import sys
import csv
import io
import json
import html as _html
import base64
import logging
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional


def _empty_to_none(v):
    """Convert empty strings to None — used on date fields to avoid PostgreSQL
    'invalid input syntax for type date: ""' errors when frontend sends blank dates."""
    return None if isinstance(v, str) and v.strip() == "" else v

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

# Import Anthropic for AI invoice scanning
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
try:
    import anthropic
    _anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
except ImportError:
    _anthropic_client = None

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/accounting", tags=["Accounting"])


# Standard Quebec construction chart of accounts (seeded for all tenants)
PLAN_COMPTABLE_SEED = [
    # ACTIF (classe 1)
    ("1010", "Encaisse generale", "ACTIF", 1, "DEBIT"),
    ("1100", "Comptes clients", "ACTIF", 1, "DEBIT"),
    ("1150", "Retenues a recevoir", "ACTIF", 1, "DEBIT"),
    ("1200", "TPS a recevoir", "ACTIF", 1, "DEBIT"),
    ("1210", "TVQ a recevoir", "ACTIF", 1, "DEBIT"),
    ("1300", "Stocks et materiaux", "ACTIF", 1, "DEBIT"),
    ("1500", "Equipements", "ACTIF", 1, "DEBIT"),
    ("1510", "Amortissement cumule - Equipements", "ACTIF", 1, "CREDIT"),
    ("1600", "Vehicules", "ACTIF", 1, "DEBIT"),
    # PASSIF (classe 2)
    ("2100", "Comptes fournisseurs", "PASSIF", 2, "CREDIT"),
    ("2200", "TPS a payer", "PASSIF", 2, "CREDIT"),
    ("2210", "TVQ a payer", "PASSIF", 2, "CREDIT"),
    ("2300", "Salaires a payer", "PASSIF", 2, "CREDIT"),
    ("2310", "Retenues a la source a payer", "PASSIF", 2, "CREDIT"),
    ("2320", "CNESST a payer", "PASSIF", 2, "CREDIT"),
    ("2400", "Emprunt bancaire", "PASSIF", 2, "CREDIT"),
    # CAPITAUX (classe 3)
    ("3100", "Capital", "CAPITAUX", 3, "CREDIT"),
    ("3200", "Benefices non repartis", "CAPITAUX", 3, "CREDIT"),
    # REVENU (classe 4)
    ("4100", "Revenus de construction", "REVENU", 4, "CREDIT"),
    ("4200", "Revenus de services", "REVENU", 4, "CREDIT"),
    ("4900", "Autres revenus", "REVENU", 4, "CREDIT"),
    # CHARGE (classe 5 - couts directs)
    ("5100", "Cout des materiaux", "CHARGE", 5, "DEBIT"),
    ("5200", "Cout de la main-d oeuvre", "CHARGE", 5, "DEBIT"),
    ("5300", "Cout de sous-traitance", "CHARGE", 5, "DEBIT"),
    ("5400", "Location equipements", "CHARGE", 5, "DEBIT"),
    ("5500", "Frais de chantier", "CHARGE", 5, "DEBIT"),
    # CHARGE (classe 6 - frais exploitation)
    ("6100", "Salaires administration", "CHARGE", 6, "DEBIT"),
    ("6200", "Loyer", "CHARGE", 6, "DEBIT"),
    ("6300", "Assurances", "CHARGE", 6, "DEBIT"),
    ("6400", "Frais de bureau", "CHARGE", 6, "DEBIT"),
    ("6500", "Telecommunications", "CHARGE", 6, "DEBIT"),
    ("6600", "Frais de vehicules", "CHARGE", 6, "DEBIT"),
    ("6700", "Honoraires professionnels", "CHARGE", 6, "DEBIT"),
    ("6800", "Amortissement", "CHARGE", 6, "DEBIT"),
    ("6900", "Frais financiers", "CHARGE", 6, "DEBIT"),
]


def _ensure_plan_comptable_seeded(cursor):
    """Seed plan_comptable with standard Quebec construction accounts if empty."""
    cursor.execute("SELECT COUNT(*) as cnt FROM plan_comptable WHERE actif = TRUE")
    count = cursor.fetchone()["cnt"]
    if count >= 20:
        return  # Already seeded
    for code, nom, type_, classe, solde_normal in PLAN_COMPTABLE_SEED:
        cursor.execute(
            "INSERT INTO plan_comptable (code, nom, type, classe, solde_normal, actif, created_at) "
            "VALUES (%s, %s, %s, %s, %s, TRUE, CURRENT_TIMESTAMP) "
            "ON CONFLICT (code) DO NOTHING",
            (code, nom, type_, classe, solde_normal),
        )


class JournalEntryCreate(BaseModel):
    libelle: str
    type_journal: str = "GENERAL"
    reference_externe: Optional[str] = None
    projet_id: Optional[int] = None
    notes: Optional[str] = None


class JournalLineCreate(BaseModel):
    compte_id: int
    compte_code: Optional[str] = None
    libelle: Optional[str] = None
    debit: float = Field(0, ge=0)
    credit: float = Field(0, ge=0)
    projet_id: Optional[str] = None

    @model_validator(mode='after')
    def check_debit_credit(self):
        if self.debit == 0 and self.credit == 0:
            raise ValueError("Debit ou credit doit etre non-zero")
        if self.debit > 0 and self.credit > 0:
            raise ValueError("Une ligne ne peut avoir debit ET credit")
        return self


class JournalLineInline(BaseModel):
    """Ligne pour creation atomique (compte_id optionnel — resolu via compte_code)."""
    compte_id: Optional[int] = None
    compte_code: Optional[str] = None
    libelle: Optional[str] = None
    debit: float = Field(0, ge=0)
    credit: float = Field(0, ge=0)
    projet_id: Optional[int] = None

    @model_validator(mode='after')
    def check_debit_credit(self):
        if self.debit == 0 and self.credit == 0:
            raise ValueError("Debit ou credit doit etre non-zero")
        if self.debit > 0 and self.credit > 0:
            raise ValueError("Une ligne ne peut avoir debit ET credit")
        if not self.compte_id and not (self.compte_code and self.compte_code.strip()):
            raise ValueError("compte_id ou compte_code requis")
        return self


class JournalEntryWithLines(BaseModel):
    """Creation atomique entete + lignes en une transaction (pas de partial)."""
    libelle: str
    type_journal: str = "GENERAL"
    reference_externe: Optional[str] = None
    projet_id: Optional[int] = None
    notes: Optional[str] = None
    lignes: list[JournalLineInline] = Field(default_factory=list)

    @model_validator(mode='after')
    def check_balance(self):
        if len(self.lignes) < 2:
            raise ValueError("Une ecriture doit avoir au moins 2 lignes")
        sum_debit = sum(float(l.debit or 0) for l in self.lignes)
        sum_credit = sum(float(l.credit or 0) for l in self.lignes)
        if abs(sum_debit - sum_credit) > 0.01:
            raise ValueError(
                f"Ecriture desequilibree: debit {sum_debit:.2f} != credit {sum_credit:.2f}"
            )
        if sum_debit == 0:
            raise ValueError("Montants nuls (debit et credit a 0)")
        return self


class InvoiceCreate(BaseModel):
    client_company_id: Optional[int] = None
    fournisseur_id: Optional[int] = None
    type_destinataire: str = "client"  # "client" or "fournisseur"
    project_id: Optional[int] = None
    devis_id: Optional[int] = None
    date_facture: Optional[str] = None
    date_echeance: Optional[str] = None
    conditions_paiement: str = "Net 30"
    notes: Optional[str] = None
    numero_facture_fournisseur: Optional[str] = None  # Original supplier invoice number

    @field_validator("date_facture", "date_echeance", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class InvoiceUpdate(BaseModel):
    client_company_id: Optional[int] = None
    project_id: Optional[int] = None
    date_facture: Optional[str] = None
    date_echeance: Optional[str] = None
    conditions_paiement: Optional[str] = None
    notes: Optional[str] = None
    notes_internes: Optional[str] = None
    statut: Optional[str] = None

    @field_validator("date_facture", "date_echeance", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


# ============================================
# CHART OF ACCOUNTS (Plan comptable)
# ============================================

@router.get("/chart-of-accounts")
async def get_chart_of_accounts(user: ErpUser = Depends(get_current_user)):
    """Get the full chart of accounts."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_plan_comptable_seeded(cursor)
        cursor.execute(
            "SELECT id, code, nom, type, classe, description, parent_id, "
            "niveau, actif, solde_normal, created_at "
            "FROM plan_comptable WHERE actif = TRUE "
            "ORDER BY code ASC"
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            items.append(d)
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_chart_of_accounts error: %s", exc)
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
# JOURNAL ENTRIES
# ============================================

@router.get("/journal")
async def list_journal_entries(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    statut: Optional[str] = None,
    type_entry: Optional[str] = None,
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres, params = [], []
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        if type_entry:
            wheres.append("type_journal = %s")
            params.append(type_entry)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM journal_entries WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT id, numero_ecriture, date_ecriture, libelle, type_journal, reference_externe, "
            f"projet_id, statut, montant_total, valide, validated_at, "
            f"created_by, validated_by, notes, created_at "
            f"FROM journal_entries WHERE {w} "
            f"ORDER BY date_ecriture DESC, id DESC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_ecriture", "validated_at", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            for k in ("montant_total",):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_journal_entries error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/journal/{entry_id}")
async def get_journal_entry(entry_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM journal_entries WHERE id = %s", (entry_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Écriture non trouvée")
        d = dict(row)
        for k in ("date_ecriture", "validated_at", "created_at"):
            if d.get(k):
                d[k] = str(d[k])
        for k in ("montant_total",):
            if d.get(k) is not None:
                d[k] = float(d[k])
        # Get lines
        cursor.execute(
            "SELECT id, compte_id, compte_code, libelle, "
            "debit, credit, projet_id "
            "FROM journal_lines WHERE journal_entry_id = %s ORDER BY id ASC",
            (entry_id,),
        )
        lines = []
        for l in cursor.fetchall():
            ld = dict(l)
            for k in ("debit", "credit"):
                if ld.get(k) is not None:
                    ld[k] = float(ld[k])
            lines.append(ld)
        d["lines"] = lines
        return d
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_journal_entry error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/journal")
async def create_journal_entry(body: JournalEntryCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # BUG #37 fix: refuser la creation d'une ecriture manuelle si la date
        # (CURRENT_DATE) tombe dans une periode comptable cloturee.
        _assert_period_open(cursor, str(date.today()), strict=True)
        # Generate entry number
        cursor.execute(
            "INSERT INTO journal_entries (numero_ecriture, date_ecriture, libelle, type_journal, "
            "reference_externe, projet_id, statut, "
            "created_by, notes, created_at) "
            "VALUES ('TEMP', CURRENT_DATE, %s, %s, %s, %s, 'BROUILLON', %s, %s, "
            "CURRENT_TIMESTAMP) RETURNING id",
            (body.libelle, body.type_journal, body.reference_externe,
             body.projet_id, user.user_id, body.notes),
        )
        row = cursor.fetchone()
        new_id = row["id"]
        numero = f"JE-{body.type_journal[:3]}-{new_id:05d}"
        cursor.execute(
            "UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s",
            (numero, new_id),
        )
        # Defensive commit: pool sans autocommit ne persiste pas sinon.
        try:
            conn.commit()
        except Exception as exc:
            logger.warning("create_journal_entry commit warning: %s", exc)
        return {"id": new_id, "numero": numero, "message": "Écriture créée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_journal_entry error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/journal/with-lines")
async def create_journal_entry_with_lines(
    body: JournalEntryWithLines,
    user: ErpUser = Depends(get_current_user),
):
    """Creation atomique d'une ecriture comptable AVEC ses lignes en une seule
    transaction. Validation Pydantic garantit debit=credit avant INSERT.

    Empeche les ecritures parentes orphelines/desequilibrees qui pouvaient
    arriver via le flow 2 etapes (POST /journal puis N x POST /journal/{}/lines)
    si une ligne echouait apres la 1ere.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        # Mode transactionnel: les INSERTs entete + lignes doivent etre atomiques.
        # Sans cela (autocommit pool), un crash entre l'INSERT entete et les
        # INSERT lignes laisserait une ecriture parente sans lignes en BD.
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_plan_comptable_seeded(cursor)

        today_str = str(date.today())
        # BUG #37 fix: blocage strict periode cloturee
        _assert_period_open(cursor, today_str, strict=True)

        # Pre-check: resoudre tous les compte_id depuis compte_code AVANT INSERT
        # pour echouer tot si un code est invalide.
        resolved = []
        for ln in body.lignes:
            cid = ln.compte_id
            ccode = (ln.compte_code or "").strip() or None
            if not cid and ccode:
                cursor.execute(
                    "SELECT id, code FROM plan_comptable WHERE code = %s AND actif = TRUE",
                    (ccode,),
                )
                r = cursor.fetchone()
                if not r:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Compte introuvable: {ccode}",
                    )
                cid = r["id"]
                ccode = r["code"]
            elif cid and not ccode:
                cursor.execute("SELECT code FROM plan_comptable WHERE id = %s", (cid,))
                r = cursor.fetchone()
                if r:
                    ccode = r["code"]
            resolved.append({
                "compte_id": cid,
                "compte_code": ccode,
                "libelle": ln.libelle or body.libelle,
                "debit": float(ln.debit or 0),
                "credit": float(ln.credit or 0),
                "projet_id": ln.projet_id,
            })

        montant_total = sum(l["debit"] for l in resolved)

        # INSERT entete + numero TEMP
        cursor.execute(
            "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, "
            "libelle, type_journal, reference_externe, projet_id, source_type, "
            "montant_total, statut, valide, notes, created_by, created_at) "
            "VALUES ('TEMP', %s, %s, %s, %s, %s, %s, 'manual', %s, 'BROUILLON', "
            "FALSE, %s, %s, CURRENT_TIMESTAMP) RETURNING id",
            (today_str, today_str, body.libelle, body.type_journal,
             body.reference_externe, body.projet_id, montant_total, body.notes,
             getattr(user, 'user_id', None)),
        )
        entry_id = cursor.fetchone()["id"]

        # Numero final base sur type_journal
        prefix_map = {
            "VENTES": "VTE", "ACHATS": "ACH", "BANQUE": "BNQ",
            "ENCAISSEMENT": "ENC", "PAIE": "PAI", "STOCK": "STK", "OD": "OD",
            "AMORTISSEMENT": "AMO", "GENERAL": "GEN",
        }
        prefix = prefix_map.get(body.type_journal.upper(), "GEN")
        cursor.execute(
            "UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s",
            (f"JE-{prefix}-{entry_id:05d}", entry_id),
        )

        # INSERT toutes les lignes
        for seq, l in enumerate(resolved, start=1):
            cursor.execute(
                "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                "libelle, debit, credit, projet_id, sequence, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)",
                (entry_id, l["compte_id"], l["compte_code"], l["libelle"],
                 l["debit"], l["credit"], l["projet_id"], seq),
            )

        # Audit trail
        _log_accounting_action(
            cursor, user, "create", "journal_entry", entry_id,
            details={
                "type_journal": body.type_journal,
                "lines": len(resolved),
                "montant_total": montant_total,
            },
        )

        try:
            conn.commit()
        except Exception as exc:
            logger.warning("create_journal_entry_with_lines commit warning: %s", exc)

        return {
            "id": entry_id,
            "numero_ecriture": f"JE-{prefix}-{entry_id:05d}",
            "lines_count": len(resolved),
            "montant_total": montant_total,
            "message": f"Ecriture creee avec {len(resolved)} lignes (equilibree)",
        }
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("create_journal_entry_with_lines error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de l'ecriture")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        _end_tx(conn, tx_modified)
        conn.close()


@router.post("/journal/{entry_id}/lines")
async def add_journal_line(entry_id: int, body: JournalLineCreate, user: ErpUser = Depends(get_current_user)):
    """Add a line to a journal entry and update totals."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, libelle, "
            "debit, credit, projet_id, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP) RETURNING id",
            (entry_id, body.compte_id, body.compte_code, body.libelle,
             body.debit, body.credit, body.projet_id),
        )
        line_id = cursor.fetchone()["id"]
        # Update entry totals
        cursor.execute(
            "UPDATE journal_entries SET "
            "montant_total = (SELECT COALESCE(SUM(debit), 0) FROM journal_lines WHERE journal_entry_id = %s) "
            "WHERE id = %s",
            (entry_id, entry_id),
        )
        # Defensive commit
        try:
            conn.commit()
        except Exception as exc:
            logger.warning("add_journal_line commit warning: %s", exc)
        return {"id": line_id, "message": "Ligne ajoutee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("add_journal_line error: %s", exc)
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
# JOURNAL ENTRY VALIDATION
# ============================================

@router.put("/journal/{entry_id}/validate")
async def validate_journal_entry(entry_id: int, user: ErpUser = Depends(get_current_user)):
    """Validate a journal entry (debits must equal credits within 0.01$)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Check balance
        cursor.execute(
            "SELECT COALESCE(SUM(debit), 0) as total_debit, "
            "COALESCE(SUM(credit), 0) as total_credit "
            "FROM journal_lines WHERE journal_entry_id = %s",
            (entry_id,),
        )
        row = cursor.fetchone()
        total_debit = float(row["total_debit"])
        total_credit = float(row["total_credit"])
        if abs(total_debit - total_credit) > 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"Écriture non equilibree: debit={total_debit:.2f}, credit={total_credit:.2f}. "
                       f"Ecart: {abs(total_debit - total_credit):.2f}$",
            )
        if total_debit == 0:
            raise HTTPException(status_code=400, detail="Aucune ligne dans cette ecriture")
        cursor.execute(
            "UPDATE journal_entries SET statut = 'VALIDEE', validated_by = %s, "
            "validated_at = CURRENT_TIMESTAMP WHERE id = %s AND statut = 'BROUILLON'",
            (str(user.user_id), entry_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=400, detail="Écriture déjà validée ou introuvable")
        # Audit trail validation
        _log_accounting_action(
            cursor, user, "validate", "journal_entry", entry_id,
            details={"total_debit": total_debit, "total_credit": total_credit},
        )
        # Defensive commit
        try:
            conn.commit()
        except Exception as exc:
            logger.warning("validate_journal_entry commit warning: %s", exc)
        return {"message": "Écriture validée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("validate_journal_entry error: %s", exc)
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
# INVOICES (Factures)
# ============================================

@router.get("/invoices")
async def list_invoices(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    limit: Optional[int] = Query(None, ge=1, le=100, description="Alias for per_page"),
    statut: Optional[str] = None,
    search: Optional[str] = None,
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    # `limit` accepted as an alias for `per_page` (cross-router convention).
    if limit is not None:
        per_page = limit
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Garantir que les colonnes de conformite/avoir + rappels/recurrence
        # existent (idempotent) avant le SELECT qui les liste — sinon erreur
        # sur tenant legacy.
        _ensure_facture_compliance_columns(cursor)
        _ensure_recurring_reminders_tables(cursor)
        wheres, params = [], []
        if statut:
            wheres.append("statut = %s")
            params.append(statut)
        if search:
            wheres.append("(LOWER(numero_facture) LIKE %s OR LOWER(client_nom) LIKE %s)")
            s = f"%{search.lower()}%"
            params.extend([s, s])
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM factures WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT id, numero, numero_facture, client_nom, client_company_id, "
            f"date_facture, date_echeance, statut, conditions_paiement, "
            f"montant_ht, montant_tps, montant_tvq, montant_total, montant_ttc, "
            f"montant_paye, solde_du, notes, created_at, "
            f"type_document, facture_origine_id, facture_origine_numero, motif_avoir, "
            f"rappels_actifs, dernier_rappel_le, nb_rappels_envoyes, facture_recurrente_id "
            f"FROM factures WHERE {w} "
            f"ORDER BY created_at DESC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_facture", "date_echeance", "date_emission", "created_at", "updated_at"):
                if d.get(k):
                    d[k] = str(d[k])
            for k in ("montant_ht", "montant_tps", "montant_tvq", "montant_total",
                       "montant_ttc", "montant_paye", "solde_du"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_invoices error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM factures WHERE id = %s", (invoice_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Facture non trouvée")
        d = dict(row)
        for k in list(d.keys()):
            if k.startswith("date") and d[k]:
                d[k] = str(d[k])
            elif k.startswith("montant") or k in ("solde_du", "tps", "tvq", "montant_ttc"):
                if d[k] is not None:
                    d[k] = float(d[k])
        return d
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_invoice error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: int, body: InvoiceUpdate, user: ErpUser = Depends(get_current_user)):
    """Update an existing invoice."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        # Mode transactionnel: la transition BROUILLON -> ENVOYEE/PAYEE genere
        # une ecriture comptable. Sans transaction explicite, l'UPDATE statut
        # est committe meme si _create_invoice_journal_entry plante => facture
        # ENVOYEE sans ecriture (bilan fausse).
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT id, statut FROM factures WHERE id = %s FOR UPDATE", (invoice_id,))
        existing = cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Facture non trouvee")
        if existing["statut"] == "PAYEE":
            raise HTTPException(status_code=400, detail="Impossible de modifier une facture PAYEE")
        # ANNULEE est modifiable: l'utilisateur peut repasser en BROUILLON via
        # le pipeline visuel (round UX) ou ajuster la note. Les LIGNES restent
        # protegees via _assert_invoice_editable (uniquement BROUILLON).

        ALLOWED = {"client_company_id", "project_id", "date_facture", "date_echeance",
                    "conditions_paiement", "notes", "notes_internes", "statut"}
        VALID_STATUTS = {"BROUILLON", "ENVOYEE", "PAYEE", "PARTIELLEMENT_PAYEE", "EN_RETARD", "ANNULEE"}
        updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in ALLOWED}
        if not updates:
            raise HTTPException(status_code=400, detail="Aucun champ a modifier")

        # Validate statut value if present
        if "statut" in updates and updates["statut"] not in VALID_STATUTS:
            raise HTTPException(status_code=400, detail=f"Statut invalide: {updates['statut']}")

        # Conformite comptable: bloquer la transition vers ANNULEE si des
        # AVOIR actifs (non annules, non brouillon) referencent cette facture.
        # Sinon: contre-passation de la facture origine + AVOIR actif laisse
        # la creance client en NEGATIF (etat comptable incoherent).
        # L'utilisateur doit d'abord annuler les AVOIR via la pipeline normale.
        if updates.get("statut") == "ANNULEE" and existing["statut"] != "ANNULEE":
            try:
                _ensure_facture_compliance_columns(cursor)
                cursor.execute(
                    "SELECT COUNT(*) AS nb, COALESCE(SUM(montant_ttc), 0) AS total "
                    "FROM factures WHERE facture_origine_id = %s "
                    "AND type_document = 'AVOIR' "
                    "AND statut NOT IN ('ANNULEE')",
                    (invoice_id,),
                )
                avoir_row = cursor.fetchone()
                if avoir_row and (avoir_row.get("nb") or 0) > 0:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Impossible d'annuler cette facture: {avoir_row['nb']} "
                            f"note(s) de credit active(s) la referencent "
                            f"(total {float(avoir_row['total']):.2f}$). Annulez d'abord "
                            "les notes de credit avant d'annuler la facture origine."
                        ),
                    )
            except HTTPException:
                raise
            except Exception as exc:
                logger.warning("avoir check pre-annulation facture %s: %s", invoice_id, exc)

        # Ensure notes_internes column exists (may be absent on older tenants).
        # SAVEPOINT-protected: update_invoice est en mode transactionnel, un
        # ALTER en echec poisonnerait la tx parente.
        if "notes_internes" in updates:
            _safe_ddl(
                cursor,
                "ALTER TABLE factures ADD COLUMN IF NOT EXISTS notes_internes TEXT",
                "sp_facture_notes_int",
                "update_invoice notes_internes",
            )

        # If client changes, validate and update client_nom
        if "client_company_id" in updates:
            cursor.execute("SELECT nom FROM companies WHERE id = %s", (updates["client_company_id"],))
            crow = cursor.fetchone()
            if not crow:
                raise HTTPException(status_code=400, detail="Entreprise client introuvable")
            updates["client_nom"] = crow["nom"]

        sets = ", ".join(f"{k} = %s" for k in updates)
        vals = list(updates.values())
        vals.append(invoice_id)
        cursor.execute(f"UPDATE factures SET {sets}, updated_at = CURRENT_TIMESTAMP WHERE id = %s", vals)

        # Auto-generate journal entry when status leaves BROUILLON
        # BUG #37 fix: strict_period=True — un user qui valide une facture sur
        # une periode cloturee doit etre bloque (HTTP 400) plutot que de creer
        # une ecriture silencieusement dans un bilan deja depose.
        journal_entry_id = None
        new_statut = updates.get("statut")
        old_statut = existing["statut"]
        if (new_statut and new_statut not in ("BROUILLON", "ANNULEE")
                and old_statut == "BROUILLON"):
            try:
                _ensure_sync_columns(cursor)
                journal_entry_id = _create_invoice_journal_entry(
                    cursor, invoice_id, strict_period=True
                )
            except HTTPException:
                # Periode cloturee ou plan comptable incomplet: laisser remonter
                # pour message user explicite (et rollback transactionnel).
                raise
            except Exception as exc:
                # Mode transactionnel: l'UPDATE statut a deja eu lieu mais
                # l'ecriture a echoue => incoherence. On re-raise pour
                # rollback, plutot que swallow + faux 200.
                logger.error("Echec generation ecriture facture %s: %s",
                             invoice_id, exc)
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Echec de la generation de l'ecriture comptable. "
                        "Le statut de la facture n'a pas ete change."
                    ),
                )

        # FIX P0 (C1): si un AVOIR change de statut, recalculer le solde_du
        # de la facture origine. Une note de credit ENVOYEE reduit la creance
        # client; une annulee la restaure. Sans ce recalcul, le solde_du stocke
        # diverge du solde reel et le cron daily marque la facture EN_RETARD
        # a tort apres un avoir non-paye.
        if new_statut and new_statut != old_statut:
            try:
                cursor.execute(
                    "SELECT type_document, facture_origine_id FROM factures WHERE id = %s",
                    (invoice_id,),
                )
                _row_check = cursor.fetchone()
                if _row_check:
                    _row_check = dict(_row_check)
                    if (_row_check.get("type_document") or "FACTURE").upper() == "AVOIR" \
                            and _row_check.get("facture_origine_id"):
                        _recalc_result = _recalculate_origin_solde_du(
                            cursor, _row_check["facture_origine_id"]
                        )
                        logger.info(
                            "AVOIR %s transition %s->%s: recalc origine %s -> %s",
                            invoice_id, old_statut, new_statut,
                            _row_check["facture_origine_id"], _recalc_result,
                        )
            except Exception as exc:
                logger.warning(
                    "AVOIR %s: recalc origine solde_du echec: %s — non-bloquant",
                    invoice_id, exc,
                )

        # Audit trail: tracer le changement de statut (avant commit)
        if new_statut and new_statut != old_statut:
            _log_accounting_action(
                cursor, user, "update", "invoice", invoice_id,
                details={
                    "old_statut": old_statut,
                    "new_statut": new_statut,
                    "journal_entry_id": journal_entry_id,
                },
            )

        # Commit explicite avant le return success (defensive: les pools
        # sans autocommit ne persistent pas sinon).
        try:
            conn.commit()
        except Exception as exc:
            logger.warning("update_invoice commit warning (likely autocommit pool): %s", exc)

        result = {"message": "Facture modifiee", "id": invoice_id}
        if journal_entry_id:
            result["journal_entry_id"] = journal_entry_id
            result["message"] = "Facture modifiee — ecriture comptable generee automatiquement"
        return result
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("update_invoice error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la modification")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        _end_tx(conn, tx_modified)
        conn.close()


@router.get("/invoices/{invoice_id}/lines")
async def get_invoice_lines(invoice_id: int, user: ErpUser = Depends(get_current_user)):
    """Get all lines for an invoice."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_facture_lignes_table(cursor)
        cursor.execute(
            "SELECT id, facture_id, description, quantite, prix_unitaire, montant, "
            "montant_ligne, sequence_ligne, categorie, notes "
            "FROM facture_lignes WHERE facture_id = %s ORDER BY sequence_ligne, id",
            (invoice_id,),
        )
        rows = cursor.fetchall()
        items = []
        for r in rows:
            d = dict(r)
            for k in ("quantite", "prix_unitaire", "montant", "montant_ligne"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_invoice_lines error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _parse_payment_days(conditions: str) -> int:
    """Extract number of days from conditions_paiement like 'Net 30', 'Net 15', etc."""
    try:
        parts = conditions.strip().split()
        for part in parts:
            if part.isdigit():
                return int(part)
    except Exception:
        pass
    return 30  # Default to 30 days


@router.post("/invoices")
async def create_invoice(body: InvoiceCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new invoice (facture) — client or supplier."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    is_supplier = body.type_destinataire == "fournisseur"
    if not is_supplier and not body.client_company_id:
        raise HTTPException(status_code=400, detail="client_company_id requis pour une facture client")
    if is_supplier and not body.fournisseur_id:
        raise HTTPException(status_code=400, detail="fournisseur_id requis pour une facture fournisseur")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Ensure supplier columns exist on old tenants
        for col, typ in [
            ("fournisseur_id", "INTEGER"),
            ("type_destinataire", "TEXT DEFAULT 'client'"),
            ("numero_facture_fournisseur", "TEXT"),
        ]:
            try:
                cursor.execute(f"ALTER TABLE factures ADD COLUMN IF NOT EXISTS {col} {typ}")
            except Exception:
                pass

        # Auto-generate numero_facture: FACT-{YYYY}-{NNNNN}
        # FIX P3 (B7): utiliser timezone Toronto pour eviter qu'une facture
        # creee a 23h EDT 31 dec se retrouve avec year=annee+1 (UTC).
        try:
            from zoneinfo import ZoneInfo
            now = datetime.now(ZoneInfo("America/Toronto"))
        except Exception:
            now = datetime.now()
        year_str = str(now.year)

        # Determine date_facture
        date_facture = body.date_facture or now.strftime("%Y-%m-%d")

        # Calculate date_echeance from conditions_paiement if not provided
        if body.date_echeance:
            date_echeance = body.date_echeance
        else:
            payment_days = _parse_payment_days(body.conditions_paiement)
            base_date = datetime.strptime(date_facture, "%Y-%m-%d")
            date_echeance = (base_date + timedelta(days=payment_days)).strftime("%Y-%m-%d")

        # Look up name
        client_nom = ""
        if is_supplier and body.fournisseur_id:
            cursor.execute("SELECT nom FROM fournisseurs WHERE id = %s", (body.fournisseur_id,))
            row = cursor.fetchone()
            if row:
                client_nom = dict(row).get("nom", "")
        elif body.client_company_id:
            cursor.execute("SELECT nom FROM companies WHERE id = %s", (body.client_company_id,))
            row = cursor.fetchone()
            if row:
                client_nom = dict(row).get("nom", "")

        # Insert with all required columns
        cursor.execute(
            "INSERT INTO factures ("
            "  numero_facture, client_company_id, fournisseur_id, type_destinataire, "
            "  client_nom, numero_facture_fournisseur, "
            "  project_id, devis_id, "
            "  date_facture, date_echeance, conditions_paiement, "
            "  taux_tps, taux_tvq, "
            "  montant_ht, tps, montant_tps, tvq, montant_tvq, "
            "  montant_ttc, montant_total, montant_paye, solde_du, "
            "  statut, notes, created_at"
            ") VALUES ("
            "  %s, %s, %s, %s, "
            "  %s, %s, "
            "  %s, %s, "
            "  %s, %s, %s, "
            "  5.0, 9.975, "
            "  0, 0, 0, 0, 0, "
            "  0, 0, 0, 0, "
            "  'BROUILLON', %s, CURRENT_TIMESTAMP"
            ") RETURNING id",
            ('TEMP', body.client_company_id, body.fournisseur_id, body.type_destinataire,
             client_nom, body.numero_facture_fournisseur,
             body.project_id, body.devis_id,
             date_facture, date_echeance, body.conditions_paiement,
             body.notes),
        )
        row = cursor.fetchone()
        facture_id = row["id"]
        numero_facture = f"FACT-{year_str}-{facture_id:05d}"
        cursor.execute(
            "UPDATE factures SET numero_facture = %s WHERE id = %s",
            (numero_facture, facture_id),
        )

        # Auto-link to opportunity dossier if project has one
        if body.project_id:
            try:
                from .crm import run_opportunity_migrations
                run_opportunity_migrations(conn, user.schema)
                cursor.execute(
                    "SELECT o.dossier_id FROM projects p "
                    "JOIN opportunities o ON p.opportunity_id = o.id "
                    "WHERE p.id = %s AND o.dossier_id IS NOT NULL",
                    (body.project_id,),
                )
                dossier_row = cursor.fetchone()
                if dossier_row:
                    # Ensure dossier_factures table exists
                    cursor.execute(
                        "CREATE TABLE IF NOT EXISTS dossier_factures ("
                        "id SERIAL PRIMARY KEY, "
                        "dossier_id INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE, "
                        "facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE, "
                        "date_association TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
                        "UNIQUE(dossier_id, facture_id))"
                    )
                    cursor.execute(
                        "INSERT INTO dossier_factures (dossier_id, facture_id, date_association) "
                        "VALUES (%s, %s, CURRENT_TIMESTAMP) ON CONFLICT (dossier_id, facture_id) DO NOTHING",
                        (dossier_row["dossier_id"], facture_id),
                    )
            except Exception:
                pass

        # Defensive commit avant return success
        try:
            conn.commit()
        except Exception as exc:
            logger.warning("create_invoice commit warning: %s", exc)

        return {
            "id": facture_id,
            "numero_facture": numero_facture,
            "date_facture": date_facture,
            "date_echeance": date_echeance,
            "message": "Facture créée",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_invoice error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la création de la facture")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# AI INVOICE SCANNING
# ============================================

_INVOICE_SCAN_SYSTEM = """Tu es un assistant IA specialise en comptabilite construction au Quebec, integre dans l'ERP Constructo AI.
Tu analyses des factures fournisseurs (photos ou PDF) et extrais les donnees structurees.
Tu connais les taxes du Quebec: TPS 5%, TVQ 9.975%.
Reponds toujours en JSON strict."""


@router.post("/invoices/ai/scan")
async def ai_scan_invoice(
    file: UploadFile = File(...),
    user: ErpUser = Depends(get_current_user),
):
    """Scan a supplier invoice image/PDF with Claude Vision and extract structured data."""
    if not _anthropic_client:
        raise HTTPException(status_code=503, detail="Service IA non disponible")
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    from .ai import check_ai_guard, _check_credits, track_ai_usage, _deduct_credits
    allowed, error_msg = check_ai_guard(user)
    if not allowed:
        raise HTTPException(status_code=403, detail=error_msg or "Acces IA refuse")
    credits_ok, _ = _check_credits(user)
    if not credits_ok:
        raise HTTPException(status_code=402, detail="Credits IA epuises")

    file_data = await file.read()
    if len(file_data) == 0:
        raise HTTPException(status_code=400, detail="Fichier vide")
    if len(file_data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Fichier trop volumineux (max 20 Mo)")

    image_b64 = base64.b64encode(file_data).decode("utf-8")
    media_type = file.content_type or "image/jpeg"
    # Detect PDF from filename or content_type
    filename = (file.filename or "").lower()
    if "pdf" in media_type.lower() or filename.endswith(".pdf"):
        media_type = "application/pdf"
    else:
        # FIX: file.content_type est attaquant-controle. Detecter le vrai type
        # via magic bytes pour eviter erreur 400 Anthropic "image/png declared
        # but appears to be image/jpeg" si le client ment sur le Content-Type.
        from .ai import _detect_media_type_from_bytes
        detected = _detect_media_type_from_bytes(file_data)
        if not detected:
            raise HTTPException(
                status_code=400,
                detail="Format image non reconnu (PNG, JPEG, GIF, WebP, BMP requis) ou PDF.",
            )
        media_type = detected

    # Load supplier list for matching
    suppliers = []
    conn = db.get_conn()
    try:
        db.set_tenant(conn, user.schema)
        cur = conn.cursor()
        cur.execute("SELECT id, nom FROM fournisseurs ORDER BY nom LIMIT 200")
        suppliers = [{"id": dict(r)["id"], "nom": dict(r)["nom"]} for r in cur.fetchall()]
        cur.close()
    except Exception:
        pass
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()

    supplier_list = ", ".join([f'{s["nom"]} (id:{s["id"]})' for s in suppliers]) if suppliers else "aucun fournisseur enregistre"

    prompt = f"""Analyse cette facture fournisseur et extrais toutes les donnees.

FOURNISSEURS CONNUS DANS LE SYSTEME:
{supplier_list}

Reponds en JSON STRICT avec cette structure:
{{
  "fournisseur_nom": "Nom du fournisseur tel qu'il apparait sur la facture",
  "fournisseur_id": null ou l'ID si tu reconnais un fournisseur de la liste,
  "numero_facture": "Numero de la facture du fournisseur",
  "date_facture": "YYYY-MM-DD",
  "date_echeance": "YYYY-MM-DD ou null si non indiquee",
  "conditions_paiement": "Net 30 ou tel qu'indique",
  "montant_ht": 0.00,
  "tps": 0.00,
  "tvq": 0.00,
  "montant_ttc": 0.00,
  "lignes": [
    {{"description": "Description de la ligne", "quantite": 1.0, "prix_unitaire": 0.00, "montant": 0.00}}
  ],
  "notes": "Informations supplementaires (adresse fournisseur, conditions speciales, etc.)",
  "confiance": "haute/moyenne/basse"
}}

REGLES:
- Extrais le montant avant taxes (montant_ht), TPS (5%), TVQ (9.975%) et total TTC
- Si les taxes ne sont pas detaillees, calcule-les a partir du total
- Detecte le fournisseur dans la liste connue si possible (matching approximatif sur le nom)
- Extrais toutes les lignes de detail si visibles
- Si c'est un PDF de plusieurs pages, analyse toutes les pages visibles
- "confiance" indique ta certitude sur l'extraction (haute si tout est clair, basse si flou/illisible)

Reponds UNIQUEMENT le JSON."""

    try:
        # Build content blocks based on media type
        if media_type == "application/pdf":
            content_blocks = [
                {"type": "document", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                {"type": "text", "text": prompt},
            ]
        else:
            content_blocks = [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                {"type": "text", "text": prompt},
            ]

        response = _anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            system=_INVOICE_SCAN_SYSTEM,
            messages=[{"role": "user", "content": content_blocks}],
            max_tokens=32000,
            temperature=0.1,
        )
        tokens_in = response.usage.input_tokens
        tokens_out = response.usage.output_tokens

        cost = (tokens_in * 0.003 + tokens_out * 0.015) / 1000 * 1.30
        track_ai_usage(user, "invoice_scan", tokens_in, tokens_out, cost, 0, success=True)
        _deduct_credits(user, cost)

        raw = response.content[0].text.strip() if response.content else ""
        # Parse JSON, handle ```json blocks
        raw = raw.strip()
        if raw.startswith('```'):
            raw = raw.split('\n', 1)[1] if '\n' in raw else raw[3:]
            raw = raw.strip()
            if raw.endswith('```'):
                raw = raw[:-3].strip()

        data = json.loads(raw)

        return {
            "fournisseurNom": data.get("fournisseur_nom", ""),
            "fournisseurId": data.get("fournisseur_id"),
            "numeroFacture": data.get("numero_facture", ""),
            "dateFacture": data.get("date_facture", ""),
            "dateEcheance": data.get("date_echeance"),
            "conditionsPaiement": data.get("conditions_paiement", "Net 30"),
            "montantHt": data.get("montant_ht", 0),
            "tps": data.get("tps", 0),
            "tvq": data.get("tvq", 0),
            "montantTtc": data.get("montant_ttc", 0),
            "lignes": data.get("lignes", []),
            "notes": data.get("notes", ""),
            "confiance": data.get("confiance", "moyenne"),
            "tokensInput": tokens_in,
            "tokensOutput": tokens_out,
        }
    except json.JSONDecodeError:
        return {
            "fournisseurNom": "", "fournisseurId": None, "numeroFacture": "",
            "dateFacture": "", "dateEcheance": None, "conditionsPaiement": "Net 30",
            "montantHt": 0, "tps": 0, "tvq": 0, "montantTtc": 0,
            "lignes": [], "notes": raw if raw else "Erreur extraction",
            "confiance": "basse", "tokensInput": 0, "tokensOutput": 0,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("ai_scan_invoice error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur du service IA")


# ============================================
# FINANCIAL SUMMARY
# ============================================

@router.get("/summary")
async def get_financial_summary(user: ErpUser = Depends(get_current_user)):
    """Get a high-level financial summary."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_plan_comptable_seeded(cursor)

        # Invoice summary
        cursor.execute(
            "SELECT "
            "COUNT(*) as total_factures, "
            "COUNT(CASE WHEN statut = 'PAYEE' THEN 1 END) as factures_payees, "
            "COUNT(CASE WHEN statut = 'EN_RETARD' THEN 1 END) as factures_retard, "
            "COALESCE(SUM(COALESCE(NULLIF(montant_total, 0), montant_ttc, 0)), 0) as ca_total, "
            "COALESCE(SUM(montant_paye), 0) as total_encaisse, "
            "COALESCE(SUM(COALESCE(NULLIF(solde_du, 0), COALESCE(NULLIF(montant_total, 0), montant_ttc, 0) - COALESCE(montant_paye, 0), 0)), 0) as total_solde_du "
            "FROM factures WHERE statut != 'ANNULEE'"
        )
        inv = cursor.fetchone()

        # Journal summary
        cursor.execute(
            "SELECT COUNT(*) as total_ecritures, "
            "COUNT(CASE WHEN statut = 'BROUILLON' THEN 1 END) as brouillons "
            "FROM journal_entries"
        )
        journal = cursor.fetchone()

        # Accounts count
        cursor.execute("SELECT COUNT(*) as total FROM plan_comptable WHERE actif = TRUE")
        accounts = cursor.fetchone()

        return {
            "total_factures": inv["total_factures"] if inv else 0,
            "factures_payees": inv["factures_payees"] if inv else 0,
            "factures_retard": inv["factures_retard"] if inv else 0,
            "ca_total": round(float(inv["ca_total"]), 2) if inv else 0,
            "total_encaisse": round(float(inv["total_encaisse"]), 2) if inv else 0,
            "total_solde_du": round(float(inv["total_solde_du"]), 2) if inv else 0,
            "total_ecritures": journal["total_ecritures"] if journal else 0,
            "ecritures_brouillon": journal["brouillons"] if journal else 0,
            "total_comptes": accounts["total"] if accounts else 0,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_financial_summary error: %s", exc)
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
# SYNC: Generate journal entries from existing factures
# ============================================

def _begin_tx(conn):
    """Force le mode transactionnel sur une connexion.

    Critique: le pool DB met les connexions en ISOLATION_LEVEL_AUTOCOMMIT
    par defaut (database_config.py:368/394). Sans ce helper, SELECT FOR UPDATE
    ne tient PAS le lock entre statements (lock libere apres chaque SELECT),
    et les commit()/rollback() sont des no-ops.

    A appeler AU DEBUT des endpoints multi-statements critiques (delete avec
    contre-passation, journal/with-lines, etc.). Restaurer autocommit en
    finally via _end_tx() pour ne pas casser la connexion suivante du pool.

    Returns True si on a modifie autocommit (a restaurer), False sinon.
    """
    try:
        if getattr(conn, 'autocommit', False):
            conn.autocommit = False
            return True
    except Exception as exc:
        logger.warning("_begin_tx: impossible de desactiver autocommit: %s", exc)
    return False


def _end_tx(conn, was_modified):
    """Restaure autocommit=True pour le pool si _begin_tx l'avait modifie."""
    if not was_modified:
        return
    # set_session/autocommit toggle requires no open transaction. If caller
    # forgot to commit/rollback before _end_tx (or an exception left the tx
    # in a dirty state), close the tx defensively before flipping autocommit
    # — otherwise psycopg2 raises "set_session cannot be used inside a
    # transaction" and the connection is returned to the pool in a broken state.
    try:
        conn.rollback()
    except Exception:
        pass
    try:
        conn.autocommit = True
    except Exception as exc:
        logger.warning("_end_tx: impossible de restaurer autocommit: %s", exc)


def _savepoint_create(cursor, name="sp_item"):
    """SAVEPOINT name. Necessite mode transactionnel (_begin_tx).

    En mode autocommit, l'appel echouera silencieusement (logged warning) et
    retourne False — le caller poursuit son flow best-effort sans atomicite.
    """
    try:
        cursor.execute(f"SAVEPOINT {name}")
        return True
    except Exception as exc:
        logger.warning("SAVEPOINT %s failed: %s", name, exc)
        return False


def _savepoint_release(cursor, name="sp_item"):
    """RELEASE SAVEPOINT (commit local du segment ouvert par _savepoint_create)."""
    try:
        cursor.execute(f"RELEASE SAVEPOINT {name}")
    except Exception as exc:
        logger.warning("RELEASE SAVEPOINT %s failed: %s", name, exc)


def _savepoint_rollback(cursor, name="sp_item"):
    """ROLLBACK TO SAVEPOINT (annule les statements depuis le savepoint).

    Critique: apres un crash en plein milieu d'une ecriture (entete OK mais
    lignes plantees), ce rollback supprime l'entete orpheline avant le
    continue de la boucle, evitant des journal_entries sans lignes.
    """
    try:
        cursor.execute(f"ROLLBACK TO SAVEPOINT {name}")
    except Exception as exc:
        logger.warning("ROLLBACK SAVEPOINT %s failed: %s", name, exc)


def _safe_ddl(cursor, sql, sp_name, log_label):
    """Execute un DDL idempotent avec SAVEPOINT pour ne PAS poisonner la
    transaction parente en cas d'echec.

    CRITIQUE: en mode transactionnel (autocommit=False, ce que _begin_tx
    active), un ALTER TABLE qui echoue (constraint deja presente, doublons,
    table inexistante, etc.) met la TRANSACTION POSTGRESQL en etat aborted.
    TOUS les statements suivants echouent alors avec
    "current transaction is aborted, commands ignored until end of
    transaction block" — ce qui transformait silencieusement un
    delete_invoice en HTTP 500 generique.

    Le SAVEPOINT permet de rollback UNIQUEMENT le DDL en echec sans
    affecter la transaction parente. En mode autocommit, le SAVEPOINT
    est inopere mais l'erreur DDL est de toutes facons isolee
    naturellement (chaque statement = sa propre tx).
    """
    sp_created = False
    try:
        try:
            cursor.execute(f"SAVEPOINT {sp_name}")
            sp_created = True
        except Exception:
            # Hors transaction (autocommit) — SAVEPOINT n'a pas d'effet,
            # on continue, l'erreur DDL ne poisonnera rien.
            pass
        cursor.execute(sql)
        if sp_created:
            try:
                cursor.execute(f"RELEASE SAVEPOINT {sp_name}")
            except Exception:
                pass
    except Exception as exc:
        if sp_created:
            try:
                cursor.execute(f"ROLLBACK TO SAVEPOINT {sp_name}")
            except Exception:
                pass
        logger.warning("%s: %s", log_label, exc)


def _ensure_unique_constraints(cursor):
    """Ajoute les contraintes UNIQUE sur factures.numero_facture et
    journal_entries.numero_ecriture (idempotent).

    Utilise un bloc DO $$ ... IF NOT EXISTS ... $$ cote PostgreSQL pour
    eviter l'ERROR log serveur "constraint already exists" (8x/semaine
    de bruit DB observe via Render logs avant ce fix). Le _safe_ddl
    SAVEPOINT-wrap reste actif comme garde-fou si le DO block lui-meme
    echouait dans un contexte transactionnel parent.
    """
    _safe_ddl(
        cursor,
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE table_schema = current_schema()
                  AND table_name = 'factures'
                  AND constraint_name = 'factures_numero_unique'
            ) THEN
                BEGIN
                    ALTER TABLE factures
                        ADD CONSTRAINT factures_numero_unique
                        UNIQUE (numero_facture);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'factures_numero_unique skipped: %', SQLERRM;
                END;
            END IF;
        END $$;
        """,
        "sp_uniq_fact",
        "_ensure_unique_constraints factures_numero_unique",
    )
    _safe_ddl(
        cursor,
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE table_schema = current_schema()
                  AND table_name = 'journal_entries'
                  AND constraint_name = 'je_numero_unique'
            ) THEN
                BEGIN
                    ALTER TABLE journal_entries
                        ADD CONSTRAINT je_numero_unique
                        UNIQUE (numero_ecriture);
                EXCEPTION WHEN OTHERS THEN
                    RAISE NOTICE 'je_numero_unique skipped: %', SQLERRM;
                END;
            END IF;
        END $$;
        """,
        "sp_uniq_je",
        "_ensure_unique_constraints je_numero_unique",
    )


def _ensure_accounting_audit_log_table(cursor):
    """Cree la table accounting_audit_log + index si elle n'existe pas.

    Audit trail (norme 7 ans Revenu Quebec): trace toutes les actions
    sensibles sur factures/ecritures/paiements. JSONB pour flexibilite
    sur le payload `details` (ex: changements de statut, snapshot avant
    suppression, etc.).

    Utilise _safe_ddl pour SAVEPOINT-protect chaque DDL (evite tx-abort
    si CREATE/INDEX echoue dans un contexte transactionnel parent).
    """
    _safe_ddl(
        cursor,
        """
        CREATE TABLE IF NOT EXISTS accounting_audit_log (
            id SERIAL PRIMARY KEY,
            user_id INTEGER,
            user_email TEXT,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id INTEGER,
            details JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "sp_audit_tbl",
        "_ensure accounting_audit_log",
    )
    _safe_ddl(
        cursor,
        "CREATE INDEX IF NOT EXISTS idx_audit_entity "
        "ON accounting_audit_log (entity_type, entity_id)",
        "sp_audit_idx_ent",
        "_ensure idx_audit_entity",
    )
    _safe_ddl(
        cursor,
        "CREATE INDEX IF NOT EXISTS idx_audit_created "
        "ON accounting_audit_log (created_at DESC)",
        "sp_audit_idx_cr",
        "_ensure idx_audit_created",
    )


def _log_accounting_action(cursor, user, action, entity_type, entity_id, details=None):
    """Helper silencieux pour ecrire dans accounting_audit_log.

    Ne bloque jamais l'action principale: si l'ecriture audit echoue
    (table absente, JSON invalide, etc.), on logge un warning et on
    continue. L'appelant DOIT etre dans une transaction qui commitera
    ensuite (le INSERT audit fait partie de la meme transaction).

    `details` peut etre un dict (serialise via json.dumps) ou None.
    """
    if cursor is None:
        return
    try:
        _ensure_accounting_audit_log_table(cursor)
        user_id = None
        user_email = None
        if user is not None:
            user_id = getattr(user, "user_id", None)
            user_email = getattr(user, "email", None)
        details_json = None
        if details is not None:
            try:
                details_json = json.dumps(details, default=str)
            except Exception as exc:
                logger.warning("_log_accounting_action serialize details: %s", exc)
                details_json = None
        # SAVEPOINT autour de l'INSERT: si la table audit n'existe pas
        # (CREATE IF NOT EXISTS a echoue plus tot), l'INSERT raise et
        # poisonnerait la tx parente sans cette protection.
        sp_created = False
        try:
            cursor.execute("SAVEPOINT sp_audit_ins")
            sp_created = True
        except Exception:
            pass
        try:
            cursor.execute(
                "INSERT INTO accounting_audit_log "
                "(user_id, user_email, action, entity_type, entity_id, details, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s::jsonb, CURRENT_TIMESTAMP)",
                (user_id, user_email, action, entity_type, entity_id, details_json),
            )
            if sp_created:
                try:
                    cursor.execute("RELEASE SAVEPOINT sp_audit_ins")
                except Exception:
                    pass
        except Exception as ins_exc:
            if sp_created:
                try:
                    cursor.execute("ROLLBACK TO SAVEPOINT sp_audit_ins")
                except Exception:
                    pass
            logger.warning(
                "_log_accounting_action INSERT %s/%s/%s failed: %s",
                action, entity_type, entity_id, ins_exc,
            )
    except Exception as exc:
        logger.warning(
            "_log_accounting_action %s/%s/%s failed: %s",
            action, entity_type, entity_id, exc,
        )


def _ensure_sync_columns(cursor):
    """Ensure journal_entry_id column exists on factures and bons_commande tables.

    Tous les DDL idempotents passent par _safe_ddl (SAVEPOINT-protected)
    pour ne PAS poisonner la transaction parente lorsque cette fonction
    est appelee depuis un endpoint transactionnel (delete_invoice,
    update_invoice, etc.).
    """
    for table in ("factures", "bons_commande"):
        _safe_ddl(
            cursor,
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS journal_entry_id INTEGER",
            f"sp_sync_col_{table}",
            f"_ensure_sync_columns {table}",
        )
    # Contraintes UNIQUE sur les numeros (idempotent, deja SAVEPOINT-protege)
    _ensure_unique_constraints(cursor)
    # Audit log table (idempotent, deja SAVEPOINT-protege)
    _ensure_accounting_audit_log_table(cursor)


def _assert_period_open(cursor, date_value, strict=True):
    """Refuse modifications dans une periode comptable cloturee.

    BUG #37 fix: enforcement strict (avant: warning seulement). Avant ce fix,
    les ecritures pouvaient etre creees/modifiees apres cloture annuelle, ce
    qui faussait les bilans deja deposes a Revenu Quebec / verifies par le CPA.

    Parametres:
    - cursor: curseur DB (tenant deja set via db.set_tenant)
    - date_value: date a verifier (str 'YYYY-MM-DD' ou datetime/date). Si None,
      ne fait rien (l'appelant n'a pas de date a verifier).
    - strict (default True): si True, raise HTTPException 400 quand la periode
      est cloturee. Si False, logge un warning seulement (utilise pour les
      jobs de SYNC retroactif ou la periode peut etre fermee mais on veut
      quand meme rattraper l'historique).

    Degradation gracieuse: si la table `periodes_comptables` n'existe pas
    (vieux tenant), on logge un warning et on continue — on ne casse pas
    la creation d'ecriture pour autant.
    """
    if not date_value:
        return
    try:
        cursor.execute(
            "SELECT id, statut FROM periodes_comptables "
            "WHERE %s::date BETWEEN date_debut AND date_fin "
            "ORDER BY id DESC LIMIT 1",
            (str(date_value),),
        )
        row = cursor.fetchone()
    except Exception as exc:
        logger.warning("_assert_period_open lookup failed: %s", exc)
        return  # Si table absente, ne bloque pas (degradation gracieuse)
    if row and (dict(row).get("statut") or "").upper() in ("CLOTUREE", "FERMEE", "CLOSED"):
        msg = (
            f"Periode comptable cloturee pour la date {date_value}. "
            "Reouvrez la periode ou utilisez une date dans une periode ouverte."
        )
        if strict:
            raise HTTPException(status_code=400, detail=msg)
        else:
            logger.warning("_assert_period_open (non-strict): %s", msg)


def _create_invoice_journal_entry(cursor, facture_id, strict_period=False):
    """Create a journal entry for a single invoice (FACTURE or AVOIR).

    Pour une FACTURE normale:
    Debit 1100 (Comptes clients) = TTC
    Credit 4100 (Revenus de construction) = HT
    Credit 2200 (TPS a payer) = TPS
    Credit 2210 (TVQ a payer) = TVQ

    Pour un AVOIR (note de credit, conformite art. 350 LTVQ):
    Inverse exact — debit/credit swappes pour CONTRE-PASSER la vente:
    Credit 1100 (Comptes clients) = TTC  -> reduit la creance
    Debit 4100 (Revenus de construction) = HT  -> reduit le revenu
    Debit 2200 (TPS a payer) = TPS  -> reduit TPS due
    Debit 2210 (TVQ a payer) = TVQ  -> reduit TVQ due

    Sans cette logique inversee, un AVOIR envoye creerait une ecriture
    POSITIVE qui doublerait artificiellement les revenus au lieu de les
    annuler — bilan FAUX (revenus surevalues, comptes clients aussi).

    Param strict_period (BUG #37): si True, refuse de creer l'ecriture si la
    date de facture tombe dans une periode comptable cloturee.

    Returns the journal_entry_id or None if skipped.
    """
    cursor.execute(
        "SELECT id, numero_facture, date_facture, date_emission, "
        "montant_ht, tps, tvq, montant_tps, montant_tvq, montant_ttc, montant_total, "
        "project_id, client_nom, journal_entry_id, "
        "type_document, facture_origine_id "
        "FROM factures WHERE id = %s",
        (facture_id,),
    )
    f = cursor.fetchone()
    if not f:
        return None
    f = dict(f)

    # Skip if already linked
    if f.get("journal_entry_id"):
        return f["journal_entry_id"]

    ttc = float(f.get("montant_ttc") or f.get("montant_total") or 0)
    if ttc == 0:
        return None

    ht = float(f.get("montant_ht") or 0)
    # IMPORTANT: prioriser `montant_tps`/`montant_tvq` qui stockent le MONTANT
    # de taxe en $. La colonne `tps`/`tvq` est legacy et a parfois contenu le
    # TAUX (5.0 / 9.975) au lieu du montant — lire ces fallbacks pourrait
    # creer des ecritures comptables avec TPS=5.00$/TVQ=9.98$ sur une facture
    # 1000$ HT au lieu de 50$/99.75$. Sentinel: si tps_val<10 pour ttc>100,
    # log un warning de detection probable du bug historique.
    tps_val = float(f.get("montant_tps") or f.get("tps") or 0)
    tvq_val = float(f.get("montant_tvq") or f.get("tvq") or 0)
    if ttc > 100 and 0 < tps_val < 10 and 0 < tvq_val < 20:
        logger.warning(
            "Facture %s: tps_val=%.2f tvq_val=%.2f sur TTC=%.2f — "
            "valeurs anormalement basses, possiblement taux stocke au lieu "
            "de montant. Verifier la colonne `tps`/`tvq` en BD.",
            facture_id, tps_val, tvq_val, ttc,
        )
    # Fallback BUG #36: legacy data sans HT explicite. Calcul approximatif
    # TTC/1.14975 — peut introduire arrondi 0.01$. A surveiller dans logs.
    # Idealement, create_invoice/update_invoice_line stockent montant_ht
    # depuis les lignes (calcul HT-puis-taxes), et on n'arrive jamais ici.
    # Le warning structure ci-dessous permet d'identifier les factures a
    # corriger en BD pour eviter la derive d'arrondi sur le bilan annuel.
    if ht == 0 and ttc > 0:
        ht = round(ttc / 1.14975, 2)
        tps_val = round(ht * 0.05, 2)
        tvq_val = round(ttc - ht - tps_val, 2)
        logger.warning(
            "BUG #36 fallback applied facture_id=%s ttc=%.2f ht_calc=%.2f "
            "tps_calc=%.2f tvq_calc=%.2f (ecart possible 0.01-0.10$ — "
            "corriger montant_ht en BD si possible)",
            facture_id, ttc, ht, tps_val, tvq_val,
        )

    # Look up accounts. Si comptes essentiels manquent, tenter le seed initial
    # (cas tenant nouveau ou migration partielle).
    account_map = {}
    for code in ('1100', '4100', '2200', '2210'):
        cursor.execute("SELECT id FROM plan_comptable WHERE code = %s AND actif = TRUE", (code,))
        row = cursor.fetchone()
        account_map[code] = row["id"] if row else None

    if not account_map.get('1100') or not account_map.get('4100'):
        # BUG #5 fix: tenter le seed avant d'echouer
        try:
            _ensure_plan_comptable_seeded(cursor)
        except Exception as exc:
            logger.warning("auto-seed plan_comptable echoue: %s", exc)
        for code in ('1100', '4100', '2200', '2210'):
            cursor.execute("SELECT id FROM plan_comptable WHERE code = %s AND actif = TRUE", (code,))
            row = cursor.fetchone()
            account_map[code] = row["id"] if row else None

    if not account_map.get('1100') or not account_map.get('4100'):
        # BUG #5 fix: NE plus retourner None silencieusement. Raise HTTPException
        # qui sera attrape par update_invoice et remonte un message clair a l'UI.
        # Avant: la facture passait ENVOYEE sans ecriture comptable -> bilan fausse.
        logger.error(
            "Plan comptable incomplet pour facture %s: 1100=%s, 4100=%s",
            facture_id, bool(account_map.get('1100')), bool(account_map.get('4100')),
        )
        raise HTTPException(
            status_code=400,
            detail=(
                "Plan comptable incomplet: les comptes 1100 (Comptes clients) "
                "et/ou 4100 (Revenus de construction) sont manquants. "
                "Ouvrez la page Comptabilite > Plan comptable et verifiez la "
                "configuration, ou contactez le support."
            ),
        )

    date_ecriture = f.get("date_facture") or f.get("date_emission") or str(date.today())
    # BUG #37 fix: verrouillage strict des periodes cloturees. strict_period=False
    # par defaut (warning seulement) pour permettre aux jobs de sync retroactif
    # de rattraper l'historique. Les appels user-explicites (update_invoice)
    # passent strict_period=True pour bloquer.
    _assert_period_open(cursor, date_ecriture, strict=strict_period)
    numero_facture = f.get("numero_facture") or str(f["id"])
    projet_id = f.get("project_id")

    # Cost center mapping
    cc_id = None
    if projet_id:
        try:
            cursor.execute(
                "SELECT id FROM cost_centers WHERE actif = TRUE AND code = %s",
                (f"PRJ-{projet_id:05d}",),
            )
            cc_row = cursor.fetchone()
            if cc_row:
                cc_id = cc_row["id"]
        except Exception:
            pass

    # Detection AVOIR: inverse exactement les debits/credits pour contre-passer
    # la vente (conformite Revenu Quebec art. 350 LTVQ).
    is_avoir = (f.get("type_document") or "FACTURE").upper() == "AVOIR"
    doc_libelle = "Note de credit" if is_avoir else "Facture"
    source_type = "note_credit" if is_avoir else "facture"
    je_prefix = "JE-AVR" if is_avoir else "JE-VTE"
    type_journal = "VENTES"  # Meme journal: l'AVOIR est une operation de vente inverse

    # Montant total de l'ecriture (TTC, en positif — les signes sont dans les lignes)
    montant_total_je = ttc

    # INSERT journal_entries RETURNING id (lecon #123)
    cursor.execute(
        "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, "
        "libelle, type_journal, source_type, source_id, montant_total, "
        "statut, validated_at, created_at) "
        "VALUES ('TEMP', %s, %s, %s, %s, %s, %s, %s, "
        "'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
        (str(date_ecriture), str(date_ecriture),
         f"{doc_libelle} {numero_facture} - {f.get('client_nom') or 'Client'}",
         type_journal, source_type, facture_id, montant_total_je),
    )
    entry_id = cursor.fetchone()["id"]
    cursor.execute("UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s",
                   (f"{je_prefix}-{entry_id:05d}", entry_id))

    # Pour AVOIR: debit/credit inverses. Helper inline pour clarte.
    def _dc(amount):
        """Retourne (debit, credit) pour FACTURE; inverse pour AVOIR."""
        if is_avoir:
            return (0, amount)  # ligne origine en debit -> credit pour AVOIR
        return (amount, 0)

    def _cd(amount):
        """Retourne (debit, credit) pour ligne origine en credit; swap pour AVOIR."""
        if is_avoir:
            return (amount, 0)  # ligne origine en credit -> debit pour AVOIR
        return (0, amount)

    # Line 1: Comptes clients (1100) — Debit pour FACTURE, Credit pour AVOIR
    d1, c1 = _dc(ttc)
    cursor.execute(
        "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
        "libelle, debit, credit, projet_id, centre_cout_id, sequence, created_at) "
        "VALUES (%s, %s, '1100', %s, %s, %s, %s, %s, 1, CURRENT_TIMESTAMP)",
        (entry_id, account_map['1100'], f"Client - {doc_libelle} {numero_facture}", d1, c1, projet_id, cc_id))

    # Line 2: Revenus (4100) — Credit pour FACTURE, Debit pour AVOIR
    d2, c2 = _cd(ht)
    cursor.execute(
        "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
        "libelle, debit, credit, projet_id, centre_cout_id, sequence, created_at) "
        "VALUES (%s, %s, '4100', %s, %s, %s, %s, %s, 2, CURRENT_TIMESTAMP)",
        (entry_id, account_map['4100'], f"Revenus - {doc_libelle} {numero_facture}", d2, c2, projet_id, cc_id))

    # Line 3: TPS a payer (2200) — Credit pour FACTURE, Debit pour AVOIR
    if tps_val > 0 and account_map.get('2200'):
        d3, c3 = _cd(tps_val)
        cursor.execute(
            "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
            "libelle, debit, credit, projet_id, centre_cout_id, sequence, created_at) "
            "VALUES (%s, %s, '2200', %s, %s, %s, %s, %s, 3, CURRENT_TIMESTAMP)",
            (entry_id, account_map['2200'], f"TPS - {doc_libelle} {numero_facture}", d3, c3, projet_id, cc_id))

    # Line 4: TVQ a payer (2210) — Credit pour FACTURE, Debit pour AVOIR
    if tvq_val > 0 and account_map.get('2210'):
        d4, c4 = _cd(tvq_val)
        cursor.execute(
            "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
            "libelle, debit, credit, projet_id, centre_cout_id, sequence, created_at) "
            "VALUES (%s, %s, '2210', %s, %s, %s, %s, %s, 4, CURRENT_TIMESTAMP)",
            (entry_id, account_map['2210'], f"TVQ - {doc_libelle} {numero_facture}", d4, c4, projet_id, cc_id))

    # Link journal entry back to facture
    cursor.execute("UPDATE factures SET journal_entry_id = %s WHERE id = %s", (entry_id, facture_id))

    return entry_id


def _reverse_invoice_journal_entries(cursor, facture_id, user=None):
    """Auto contre-passation pour TOUTES les ecritures liees a une facture.

    Pratique comptable canadienne (CGAAP/IFRS): on ne supprime JAMAIS une
    ecriture validee. Pour annuler les effets d'une facture annulee, on
    cree une ecriture inverse (debit/credit swappes) qui ramene les comptes
    a zero. L'original ET la contre-passation restent en BD pour l'audit
    trail (norme 7 ans Revenu Quebec).

    Couvre:
    - L'ecriture VENTES principale (source_type='facture')
    - Tous les encaissements lies (source_type='paiement_facture')

    `user` est optionnel (kwarg) pour preserver la signature pour les
    appelants existants. Si fourni, on logge l'action dans
    accounting_audit_log a la fin (audit trail).

    Returns: nombre d'ecritures contre-passees.
    """
    reversed_count = 0
    today_str = str(date.today())

    # BUG #37 fix: la contre-passation cree des ecritures datees du JOUR
    # courant; si aujourd'hui tombe dans une periode cloturee, refuser.
    # (Il faudrait reouvrir la periode courante ou attendre la prochaine
    # periode ouverte avant d'annuler la facture.)
    _assert_period_open(cursor, today_str, strict=True)

    cursor.execute(
        "SELECT id, numero_ecriture, type_journal, libelle, montant_total, "
        "source_type, source_id "
        "FROM journal_entries "
        "WHERE source_id = %s AND source_type IN ('facture', 'paiement_facture', 'note_credit') "
        "AND COALESCE(libelle, '') NOT LIKE 'CONTRE-PASSATION%%' "
        "ORDER BY id",
        (facture_id,),
    )
    original_entries = [dict(r) for r in cursor.fetchall()]

    for orig in original_entries:
        orig_id = orig["id"]
        orig_num = orig.get("numero_ecriture") or str(orig_id)
        orig_type_journal = orig.get("type_journal") or "OD"
        orig_source_type = orig.get("source_type") or "facture"
        orig_libelle = orig.get("libelle") or ""
        orig_montant = float(orig.get("montant_total") or 0)

        # Eviter double contre-passation: skip si une CP existe deja pour cette ecriture
        cursor.execute(
            "SELECT id FROM journal_entries "
            "WHERE source_id = %s AND source_type = %s "
            "AND libelle LIKE %s LIMIT 1",
            (facture_id, orig_source_type, f"CONTRE-PASSATION {orig_num}%"),
        )
        if cursor.fetchone():
            continue

        # Pre-check: si l'ecriture originale n'a aucune ligne, on ne cree pas
        # de CP (qui serait elle-meme vide et desequilibree). On log un warning
        # et on saute — laissant l'utilisateur ou un admin nettoyer manuellement.
        cursor.execute(
            "SELECT compte_id, compte_code, libelle, debit, credit, "
            "projet_id, centre_cout_id, sequence "
            "FROM journal_lines WHERE journal_entry_id = %s ORDER BY sequence, id",
            (orig_id,),
        )
        lines = [dict(r) for r in cursor.fetchall()]
        if not lines:
            logger.warning(
                "Ecriture %s (facture %s) sans lignes journal_lines — "
                "CP non creee (rien a contre-passer)",
                orig_num, facture_id,
            )
            continue

        rev_libelle = f"CONTRE-PASSATION {orig_num} - {orig_libelle}"[:255]

        cursor.execute(
            "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, "
            "libelle, type_journal, source_type, source_id, montant_total, "
            "statut, validated_at, created_at) "
            "VALUES ('TEMP', %s, %s, %s, %s, %s, %s, %s, "
            "'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
            (today_str, today_str, rev_libelle, orig_type_journal,
             orig_source_type, facture_id, orig_montant),
        )
        new_id = cursor.fetchone()["id"]
        cursor.execute(
            "UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s",
            (f"JE-CP-{new_id:05d}", new_id),
        )

        for ln in lines:
            cursor.execute(
                "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                "libelle, debit, credit, projet_id, centre_cout_id, sequence, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)",
                (new_id, ln.get("compte_id"), ln.get("compte_code"),
                 f"CP - {ln.get('libelle') or ''}"[:255],
                 float(ln.get("credit") or 0),  # debit <- credit (swap)
                 float(ln.get("debit") or 0),   # credit <- debit (swap)
                 ln.get("projet_id"), ln.get("centre_cout_id"),
                 ln.get("sequence") or 1),
            )
        reversed_count += 1

    # Delie la facture de toutes ses ecritures (audit trail conserve via source_id)
    if reversed_count > 0:
        try:
            cursor.execute(
                "UPDATE factures SET journal_entry_id = NULL WHERE id = %s",
                (facture_id,),
            )
        except Exception as exc:
            logger.warning("unlink facture %s journal_entry_id failed: %s", facture_id, exc)

    # Audit trail: tracer la contre-passation (norme 7 ans Revenu Quebec).
    # Silencieux si user absent ou si l'audit echoue.
    if reversed_count > 0:
        _log_accounting_action(
            cursor, user, "reverse", "invoice", facture_id,
            details={"reversed_entries": reversed_count},
        )

    return reversed_count


@router.post("/sync-all")
async def sync_all_accounting(user: ErpUser = Depends(get_current_user)):
    """Run all accounting sync in one call: factures + depenses + time entries.
    Ensures required columns exist before syncing.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        # Mode transactionnel pour activer les SAVEPOINT par-item: si une
        # ecriture crash en plein milieu (entete OK, lignes plantees), on
        # rollback uniquement cette ecriture, pas tout le batch.
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Ensure columns exist
        _ensure_sync_columns(cursor)

        # Build project_id -> cost_center_id mapping for centre_cout_id population
        project_cc_map = {}
        try:
            cursor.execute("SELECT id, code FROM cost_centers WHERE actif = TRUE AND code LIKE 'PRJ-%'")
            for row in cursor.fetchall():
                # Extract project id from code like "PRJ-00005" -> 5
                try:
                    pid = int(row["code"].replace("PRJ-", "").lstrip("0") or "0")
                    if pid > 0:
                        project_cc_map[pid] = row["id"]
                except (ValueError, AttributeError):
                    pass
        except Exception:
            pass  # cost_centers table may not exist

        results = {"factures_synced": 0, "paiements_synced": 0, "bc_synced": 0, "labor_synced": 0, "payroll_synced": 0}

        # --- SYNC FACTURES (uses shared _create_invoice_journal_entry helper) ---
        cursor.execute(
            "SELECT id FROM factures "
            "WHERE UPPER(statut) NOT IN ('BROUILLON', 'ANNULEE') "
            "AND journal_entry_id IS NULL "
            "ORDER BY id LIMIT 200"
        )
        facture_ids = [row["id"] for row in cursor.fetchall()]
        for fid in facture_ids:
            _savepoint_create(cursor, "sp_item")
            try:
                entry_id = _create_invoice_journal_entry(cursor, fid)
                if entry_id:
                    results["factures_synced"] += 1
                _savepoint_release(cursor, "sp_item")
            except Exception as exc:
                _savepoint_rollback(cursor, "sp_item")
                logger.warning("sync_all facture %s journal failed: %s", fid, exc)

        # Account map needed for encaissements below
        account_map = {}
        for code in ('1100', '4100', '2200', '2210', '1010'):
            cursor.execute("SELECT id FROM plan_comptable WHERE code = %s AND actif = TRUE", (code,))
            row = cursor.fetchone()
            account_map[code] = row["id"] if row else None

        # Encaissements
        if account_map.get('1100'):
            cursor.execute(
                "SELECT f.id, f.numero_facture, f.montant_paye, f.project_id, f.client_nom, f.date_paiement "
                "FROM factures f "
                "WHERE COALESCE(f.montant_paye, 0) > 0 "
                "AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'paiement_facture' AND je.source_id = f.id) "
                "ORDER BY f.id LIMIT 200"
            )
            for p in [dict(r) for r in cursor.fetchall()]:
                montant_paye = float(p["montant_paye"])
                if montant_paye <= 0:
                    continue
                _savepoint_create(cursor, "sp_item")
                try:
                    date_paiement = p.get("date_paiement") or "2026-01-01"
                    numero_facture = p.get("numero_facture") or str(p["id"])
                    cursor.execute(
                        "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, "
                        "libelle, type_journal, source_type, source_id, montant_total, "
                        "statut, validated_at, created_at) "
                        "VALUES ('TEMP', %s, %s, %s, 'ENCAISSEMENT', 'paiement_facture', %s, %s, "
                        "'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                        (str(date_paiement), str(date_paiement),
                         f"Encaissement {numero_facture} - {p.get('client_nom') or 'Client'}",
                         p["id"], montant_paye))
                    enc_id = cursor.fetchone()["id"]
                    cursor.execute("UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s",
                                   (f"JE-ENC-{enc_id:05d}", enc_id))
                    enc_cc_id = project_cc_map.get(p.get("project_id")) if p.get("project_id") else None
                    if account_map.get('1010'):
                        cursor.execute(
                            "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                            "libelle, debit, credit, projet_id, centre_cout_id, sequence, created_at) "
                            "VALUES (%s, %s, '1010', %s, %s, 0, %s, %s, 1, CURRENT_TIMESTAMP)",
                            (enc_id, account_map['1010'], f"Encaissement {numero_facture}", montant_paye, p.get("project_id"), enc_cc_id))
                    cursor.execute(
                        "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                        "libelle, debit, credit, projet_id, centre_cout_id, sequence, created_at) "
                        "VALUES (%s, %s, '1100', %s, 0, %s, %s, %s, 2, CURRENT_TIMESTAMP)",
                        (enc_id, account_map['1100'], f"Encaissement {numero_facture}", montant_paye, p.get("project_id"), enc_cc_id))
                    results["paiements_synced"] += 1
                    _savepoint_release(cursor, "sp_item")
                except Exception as exc:
                    _savepoint_rollback(cursor, "sp_item")
                    logger.warning("sync_all encaissement facture %s failed: %s", p.get("id"), exc)

        # --- SYNC DEPENSES (BC + main-oeuvre) ---
        acct = {}
        for code in ('1200', '1210', '2100', '2300', '5100', '5200', '5300', '5400'):
            cursor.execute("SELECT id FROM plan_comptable WHERE code = %s AND actif = TRUE", (code,))
            r = cursor.fetchone()
            acct[code] = r["id"] if r else None

        if acct.get('2100') and acct.get('5100'):
            try:
                cursor.execute(
                    "SELECT id, numero, fournisseur_nom, sous_total, tps, tvq, total, "
                    "montant_total, project_id, date_commande "
                    "FROM bons_commande "
                    "WHERE LOWER(statut) NOT IN ('annule', 'annulee', 'brouillon') "
                    "AND journal_entry_id IS NULL "
                    "AND COALESCE(total, montant_total, 0) > 0 "
                    "ORDER BY id LIMIT 200"
                )
                bcs = [dict(r) for r in cursor.fetchall()]
            except Exception as exc:
                logger.warning("sync BC query error (old tenant?): %s", exc)
                bcs = []
            for bc in bcs:
                _savepoint_create(cursor, "sp_item")
                try:
                    ttc = float(bc.get("total") or bc.get("montant_total") or 0)
                    ht = float(bc.get("sous_total") or 0)
                    tps_val = float(bc.get("tps") or 0)
                    tvq_val = float(bc.get("tvq") or 0)
                    if ht == 0 and ttc > 0:
                        ht = round(ttc / 1.14975, 2)
                        tps_val = round(ht * 0.05, 2)
                        tvq_val = round(ttc - ht - tps_val, 2)
                    expense_code = _classify_expense_account(bc.get("fournisseur_nom") or "")
                    expense_id = acct.get(expense_code) or acct.get('5100')
                    date_cmd = bc.get("date_commande") or "2026-01-01"
                    numero = bc.get("numero") or str(bc["id"])
                    cursor.execute(
                        "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, "
                        "libelle, type_journal, source_type, source_id, montant_total, "
                        "statut, validated_at, created_at) "
                        "VALUES ('TEMP', %s, %s, %s, 'ACHAT', 'bon_commande', %s, %s, "
                        "'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                        (str(date_cmd), str(date_cmd),
                         f"Achat {numero} - {bc.get('fournisseur_nom') or 'Fournisseur'}",
                         bc["id"], ttc))
                    entry_id = cursor.fetchone()["id"]
                    cursor.execute("UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s",
                                   (f"JE-ACH-{entry_id:05d}", entry_id))
                    bc_cc_id = project_cc_map.get(bc.get("project_id")) if bc.get("project_id") else None
                    cursor.execute(
                        "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                        "libelle, debit, credit, projet_id, centre_cout_id, sequence, created_at) "
                        "VALUES (%s, %s, %s, %s, %s, 0, %s, %s, 1, CURRENT_TIMESTAMP)",
                        (entry_id, expense_id, expense_code, f"Charge - {numero}", ht, bc.get("project_id"), bc_cc_id))
                    if tps_val > 0 and acct.get('1200'):
                        cursor.execute(
                            "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                            "libelle, debit, credit, projet_id, centre_cout_id, sequence, created_at) "
                            "VALUES (%s, %s, '1200', %s, %s, 0, %s, %s, 2, CURRENT_TIMESTAMP)",
                            (entry_id, acct['1200'], f"TPS - {numero}", tps_val, bc.get("project_id"), bc_cc_id))
                    if tvq_val > 0 and acct.get('1210'):
                        cursor.execute(
                            "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                            "libelle, debit, credit, projet_id, centre_cout_id, sequence, created_at) "
                            "VALUES (%s, %s, '1210', %s, %s, 0, %s, %s, 3, CURRENT_TIMESTAMP)",
                            (entry_id, acct['1210'], f"TVQ - {numero}", tvq_val, bc.get("project_id"), bc_cc_id))
                    cursor.execute(
                        "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                        "libelle, debit, credit, projet_id, centre_cout_id, sequence, created_at) "
                        "VALUES (%s, %s, '2100', %s, 0, %s, %s, %s, 4, CURRENT_TIMESTAMP)",
                        (entry_id, acct['2100'], f"Fournisseur - {numero}", ttc, bc.get("project_id"), bc_cc_id))
                    cursor.execute("UPDATE bons_commande SET journal_entry_id = %s WHERE id = %s",
                                   (entry_id, bc["id"]))
                    results["bc_synced"] += 1
                    _savepoint_release(cursor, "sp_item")
                except Exception as exc:
                    _savepoint_rollback(cursor, "sp_item")
                    logger.warning("sync_all BC %s journal failed: %s", bc.get("id"), exc)

            # Time entries (labor grouped by month)
            if acct.get('5200') and acct.get('2300'):
                try:
                    cursor.execute(
                        "SELECT date_trunc('month', te.punch_in) as mois, "
                        "SUM(te.total_hours) as heures, "
                        "SUM(te.total_hours * COALESCE(e.taux_horaire, e.salaire / 2080.0, 0)) as cout "
                        "FROM time_entries te "
                        "LEFT JOIN employees e ON e.id = te.employee_id "
                        "WHERE te.total_hours > 0 "
                        "GROUP BY date_trunc('month', te.punch_in) "
                        "HAVING SUM(te.total_hours) > 0"
                    )
                    for m in [dict(r) for r in cursor.fetchall()]:
                        cout = round(float(m["cout"] or 0), 2)
                        if cout <= 0:
                            continue
                        _savepoint_create(cursor, "sp_item")
                        try:
                            heures = round(float(m["heures"] or 0), 2)
                            mois_str = str(m["mois"])[:7] if m["mois"] else "2026-01"
                            date_fin = str(m["mois"])[:10] if m["mois"] else "2026-01-01"
                            # Check dedup: libelle (sync-all) or description (sync-depenses)
                            already_synced = False
                            cursor.execute(
                                "SELECT id FROM journal_entries WHERE source_type = 'time_entries' "
                                "AND libelle LIKE %s",
                                (f"Main-oeuvre {mois_str}%",))
                            if cursor.fetchone():
                                already_synced = True
                            if not already_synced:
                                # Sous-savepoint: si description column absente, le SELECT plante
                                # toute la transaction en mode tx — SAVEPOINT imbrique evite ca.
                                _savepoint_create(cursor, "sp_desc_check")
                                try:
                                    cursor.execute(
                                        "SELECT id FROM journal_entries WHERE source_type = 'time_entries' "
                                        "AND description = %s",
                                        (f"Main-oeuvre {mois_str}",))
                                    if cursor.fetchone():
                                        already_synced = True
                                    _savepoint_release(cursor, "sp_desc_check")
                                except Exception:
                                    _savepoint_rollback(cursor, "sp_desc_check")
                            if already_synced:
                                _savepoint_release(cursor, "sp_item")
                                continue
                            cursor.execute(
                                "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, "
                                "libelle, type_journal, source_type, montant_total, "
                                "statut, validated_at, created_at) "
                                "VALUES ('TEMP', %s, %s, %s, 'SALAIRE', 'time_entries', %s, "
                                "'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                                (date_fin, date_fin, f"Main-oeuvre {mois_str} ({heures}h)", cout))
                            entry_id = cursor.fetchone()["id"]
                            cursor.execute("UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s",
                                           (f"JE-SAL-{entry_id:05d}", entry_id))
                            cursor.execute(
                                "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                                "libelle, debit, credit, centre_cout_id, sequence, created_at) "
                                "VALUES (%s, %s, '5200', %s, %s, 0, NULL, 1, CURRENT_TIMESTAMP)",
                                (entry_id, acct['5200'], f"Main-oeuvre {mois_str} - {heures}h", cout))
                            cursor.execute(
                                "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                                "libelle, debit, credit, centre_cout_id, sequence, created_at) "
                                "VALUES (%s, %s, '2300', %s, 0, %s, NULL, 2, CURRENT_TIMESTAMP)",
                                (entry_id, acct['2300'], f"Salaires a payer {mois_str}", cout))
                            results["labor_synced"] += 1
                            _savepoint_release(cursor, "sp_item")
                        except Exception as exc:
                            _savepoint_rollback(cursor, "sp_item")
                            logger.warning("sync_all labor mois %s failed: %s", m.get("mois"), exc)
                except Exception as exc:
                    logger.warning("sync labor error: %s", exc)

        # --- SYNC PAYROLL_RUNS (statut APPROUVE/PAYE sans journal_entry_id) ---
        # Comble le gap apres suppression du trigger PG trg_payroll_run_journal
        # par la migration 20260307_0001 (Phase 3 — Python-only payroll).
        try:
            _ensure_payroll_sync_columns(cursor)
            # SELECT FOR UPDATE SKIP LOCKED: anti-race pour syncs concurrentes
            # (deux users/jobs qui declenchent /sync-all en parallele). SKIP
            # LOCKED renvoie immediatement les rows non lockees plutot que de
            # bloquer ce qui evite contention sur de gros batches.
            cursor.execute(
                "SELECT id FROM payroll_runs "
                "WHERE UPPER(statut) IN ('APPROUVE', 'PAYE') "
                "AND journal_entry_id IS NULL "
                "ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED"
            )
            payroll_ids = [row["id"] for row in cursor.fetchall()]
            for prid in payroll_ids:
                _savepoint_create(cursor, "sp_item")
                try:
                    pe_id = _create_payroll_journal_entry(cursor, prid, user=user)
                    if pe_id:
                        results["payroll_synced"] += 1
                    _savepoint_release(cursor, "sp_item")
                except Exception as exc:
                    _savepoint_rollback(cursor, "sp_item")
                    logger.warning("sync_all payroll_run %s journal failed: %s", prid, exc)
        except Exception as exc:
            logger.warning("sync_all payroll section error: %s", exc)

        # Defensive commit final (no-op si autocommit, persist sinon)
        try:
            conn.commit()
        except Exception as exc:
            logger.warning("sync_all_accounting commit warning: %s", exc)

        total = (results["factures_synced"] + results["paiements_synced"]
                 + results["bc_synced"] + results["labor_synced"]
                 + results["payroll_synced"])
        return {
            "message": f"Sync: {results['factures_synced']} factures, {results['paiements_synced']} paiements, "
                       f"{results['bc_synced']} BC, {results['labor_synced']} main-oeuvre, "
                       f"{results['payroll_synced']} paie",
            **results,
            "total_synced": total,
        }
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("sync_all_accounting error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la synchronisation comptable")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        _end_tx(conn, tx_modified)
        conn.close()


@router.post("/sync-factures")
async def sync_factures_journal_entries(user: ErpUser = Depends(get_current_user)):
    """Generate journal entries retroactively for all non-brouillon factures missing journal_entry_id.
    Uses plan_comptable codes: 1100=Comptes clients, 4100=Revenus, 2200=TPS a payer, 2210=TVQ a payer.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Get plan_comptable IDs
        account_map = {}
        for code in ('1100', '4100', '2200', '2210', '1010'):
            cursor.execute("SELECT id FROM plan_comptable WHERE code = %s AND actif = TRUE", (code,))
            row = cursor.fetchone()
            account_map[code] = row["id"] if row else None

        if not account_map.get('1100') or not account_map.get('4100'):
            raise HTTPException(status_code=400, detail="Comptes 1100 et 4100 requis dans le plan comptable")

        # Sync factures using shared helper
        _ensure_sync_columns(cursor)
        cursor.execute(
            "SELECT id FROM factures "
            "WHERE UPPER(statut) NOT IN ('BROUILLON', 'ANNULEE') "
            "AND journal_entry_id IS NULL "
            "ORDER BY id"
        )
        facture_ids = [row["id"] for row in cursor.fetchall()]
        created = 0
        for fid in facture_ids:
            try:
                entry_id = _create_invoice_journal_entry(cursor, fid)
                if entry_id:
                    created += 1
            except Exception as exc:
                logger.warning("sync_factures journal for facture %s failed: %s", fid, exc)

        # Also create ENCAISSEMENT entries for factures with montant_paye > 0
        cursor.execute(
            "SELECT f.id, f.numero_facture, f.montant_paye, f.project_id, f.client_nom, f.date_paiement "
            "FROM factures f "
            "WHERE COALESCE(f.montant_paye, 0) > 0 "
            "AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_type = 'paiement_facture' AND je.source_id = f.id) "
            "ORDER BY f.id"
        )
        paiements = [dict(r) for r in cursor.fetchall()]
        paiements_created = 0

        for p in paiements:
            montant_paye = float(p["montant_paye"])
            if montant_paye <= 0:
                continue
            date_paiement = p.get("date_paiement") or "2026-01-01"
            numero_facture = p.get("numero_facture") or str(p["id"])

            cursor.execute(
                "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, "
                "libelle, type_journal, source_type, source_id, "
                "montant_total, statut, validated_at, created_at) "
                "VALUES ('TEMP', %s, %s, %s, 'ENCAISSEMENT', 'paiement_facture', %s, %s, "
                "'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                (str(date_paiement), str(date_paiement),
                 f"Encaissement {numero_facture} - {p.get('client_nom') or 'Client'}",
                 p["id"], montant_paye),
            )
            enc_id = cursor.fetchone()["id"]
            enc_numero = f"JE-ENC-{enc_id:05d}"
            cursor.execute("UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s", (enc_numero, enc_id))

            # Debit Encaisse (1010)
            if account_map.get('1010'):
                cursor.execute(
                    "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                    "libelle, debit, credit, projet_id, sequence, created_at) "
                    "VALUES (%s, %s, '1010', %s, %s, 0, %s, 1, CURRENT_TIMESTAMP)",
                    (enc_id, account_map['1010'],
                     f"Encaissement {numero_facture}", montant_paye, p.get("project_id")),
                )
            # Credit Comptes clients (1100)
            cursor.execute(
                "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                "libelle, debit, credit, projet_id, sequence, created_at) "
                "VALUES (%s, %s, '1100', %s, 0, %s, %s, 2, CURRENT_TIMESTAMP)",
                (enc_id, account_map['1100'],
                 f"Encaissement {numero_facture}", montant_paye, p.get("project_id")),
            )
            paiements_created += 1

        return {
            "message": f"Sync terminee: {created} ecritures factures + {paiements_created} ecritures paiements creees",
            "factures_synced": created,
            "paiements_synced": paiements_created,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("sync_factures_journal_entries error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la synchronisation")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# SYNC: Generate expense entries from bons_commande + time_entries
# ============================================

SOUS_TRAITANCE_KEYWORDS = (
    'électri', 'plomber', 'ventilat', 'toiture', 'maestria', 'démolition',
    'excavat', 'maçon', 'gicleur', 'sécurité', 'alarme', 'roofmart',
    'chauffag', 'peintur',
)


def _classify_expense_account(fournisseur_nom: str):
    """Classify a supplier into expense account codes: 5100 materiaux, 5300 sous-traitance, 5400 location."""
    fn = (fournisseur_nom or "").lower()
    if 'location' in fn or 'hewitt' in fn or 'lou-tec' in fn:
        return '5400'
    for kw in SOUS_TRAITANCE_KEYWORDS:
        if kw in fn:
            return '5300'
    return '5100'


@router.post("/sync-depenses")
async def sync_depenses_journal_entries(user: ErpUser = Depends(get_current_user)):
    """Generate expense journal entries from bons_commande and time_entries.
    BC entries: Debit expense (5100/5300/5400) + TPS(1200) + TVQ(1210), Credit fournisseurs(2100).
    Labor entries: Debit 5200, Credit 2300 Salaires a payer. Grouped by month.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Get account IDs
        acct = {}
        for code in ('1200', '1210', '2100', '2300', '5100', '5200', '5300', '5400'):
            cursor.execute("SELECT id FROM plan_comptable WHERE code = %s AND actif = TRUE", (code,))
            r = cursor.fetchone()
            acct[code] = r["id"] if r else None

        if not acct.get('2100') or not acct.get('5100'):
            raise HTTPException(status_code=400, detail="Comptes 2100 et 5100 requis dans le plan comptable")

        # --- BONS DE COMMANDE ---
        cursor.execute(
            "SELECT id, numero, fournisseur_nom, sous_total, tps, tvq, total, "
            "montant_total, project_id, date_commande "
            "FROM bons_commande "
            "WHERE LOWER(statut) NOT IN ('annule', 'annulee', 'brouillon') "
            "AND journal_entry_id IS NULL "
            "AND COALESCE(total, montant_total, 0) > 0 "
            "ORDER BY id"
        )
        bcs = [dict(r) for r in cursor.fetchall()]
        bc_created = 0

        for bc in bcs:
            ttc = float(bc.get("total") or bc.get("montant_total") or 0)
            ht = float(bc.get("sous_total") or 0)
            tps_val = float(bc.get("tps") or 0)
            tvq_val = float(bc.get("tvq") or 0)
            if ht == 0 and ttc > 0:
                ht = round(ttc / 1.14975, 2)
                tps_val = round(ht * 0.05, 2)
                tvq_val = round(ttc - ht - tps_val, 2)

            expense_code = _classify_expense_account(bc.get("fournisseur_nom") or "")
            expense_id = acct.get(expense_code) or acct.get('5100')
            date_cmd = bc.get("date_commande") or "2026-01-01"
            numero = bc.get("numero") or str(bc["id"])

            cursor.execute(
                "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, "
                "libelle, type_journal, source_type, source_id, montant_total, "
                "statut, validated_at, created_at) "
                "VALUES ('TEMP', %s, %s, %s, 'ACHAT', 'bon_commande', %s, %s, "
                "'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                (str(date_cmd), str(date_cmd),
                 f"Achat {numero} - {bc.get('fournisseur_nom') or 'Fournisseur'}",
                 bc["id"], ttc),
            )
            entry_id = cursor.fetchone()["id"]
            cursor.execute("UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s",
                           (f"JE-ACH-{entry_id:05d}", entry_id))

            # Debit expense account (HT)
            cursor.execute(
                "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                "libelle, debit, credit, projet_id, sequence, created_at) "
                "VALUES (%s, %s, %s, %s, %s, 0, %s, 1, CURRENT_TIMESTAMP)",
                (entry_id, expense_id, expense_code, f"Charge - {numero}", ht, bc.get("project_id")),
            )
            # Debit TPS a recevoir
            if tps_val > 0 and acct.get('1200'):
                cursor.execute(
                    "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                    "libelle, debit, credit, projet_id, sequence, created_at) "
                    "VALUES (%s, %s, '1200', %s, %s, 0, %s, 2, CURRENT_TIMESTAMP)",
                    (entry_id, acct['1200'], f"TPS - {numero}", tps_val, bc.get("project_id")),
                )
            # Debit TVQ a recevoir
            if tvq_val > 0 and acct.get('1210'):
                cursor.execute(
                    "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                    "libelle, debit, credit, projet_id, sequence, created_at) "
                    "VALUES (%s, %s, '1210', %s, %s, 0, %s, 3, CURRENT_TIMESTAMP)",
                    (entry_id, acct['1210'], f"TVQ - {numero}", tvq_val, bc.get("project_id")),
                )
            # Credit Comptes fournisseurs (TTC)
            cursor.execute(
                "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                "libelle, debit, credit, projet_id, sequence, created_at) "
                "VALUES (%s, %s, '2100', %s, 0, %s, %s, 4, CURRENT_TIMESTAMP)",
                (entry_id, acct['2100'], f"Fournisseur - {numero}", ttc, bc.get("project_id")),
            )
            cursor.execute("UPDATE bons_commande SET journal_entry_id = %s WHERE id = %s",
                           (entry_id, bc["id"]))
            bc_created += 1

        # --- TIME ENTRIES (labor costs grouped by month) ---
        labor_created = 0
        if acct.get('5200') and acct.get('2300'):
            cursor.execute(
                "SELECT date_trunc('month', te.punch_in) as mois, "
                "SUM(te.total_hours) as heures, "
                "SUM(te.total_hours * COALESCE(e.taux_horaire, e.salaire / 2080.0, 0)) as cout "
                "FROM time_entries te "
                "LEFT JOIN employees e ON e.id = te.employee_id "
                "WHERE te.total_hours > 0 "
                "GROUP BY date_trunc('month', te.punch_in) "
                "HAVING SUM(te.total_hours) > 0"
            )
            months = [dict(r) for r in cursor.fetchall()]
            for m in months:
                cout = round(float(m["cout"] or 0), 2)
                if cout <= 0:
                    continue
                heures = round(float(m["heures"] or 0), 2)
                mois_str = str(m["mois"])[:7] if m["mois"] else "2026-01"
                date_fin = str(m["mois"])[:10] if m["mois"] else "2026-01-01"

                # Check if already synced
                cursor.execute(
                    "SELECT id FROM journal_entries WHERE source_type = 'time_entries' AND description = %s",
                    (f"Main-oeuvre {mois_str}",),
                )
                if cursor.fetchone():
                    continue

                cursor.execute(
                    "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, "
                    "libelle, description, type_journal, source_type, montant_total, "
                    "statut, validated_at, created_at) "
                    "VALUES ('TEMP', %s, %s, %s, %s, 'SALAIRE', 'time_entries', %s, "
                    "'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                    (date_fin, date_fin,
                     f"Main-oeuvre {mois_str} ({heures}h)",
                     f"Main-oeuvre {mois_str}",
                     cout),
                )
                entry_id = cursor.fetchone()["id"]
                cursor.execute("UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s",
                               (f"JE-SAL-{entry_id:05d}", entry_id))
                cursor.execute(
                    "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                    "libelle, debit, credit, sequence, created_at) "
                    "VALUES (%s, %s, '5200', %s, %s, 0, 1, CURRENT_TIMESTAMP)",
                    (entry_id, acct['5200'], f"Main-oeuvre {mois_str} - {heures}h", cout),
                )
                cursor.execute(
                    "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
                    "libelle, debit, credit, sequence, created_at) "
                    "VALUES (%s, %s, '2300', %s, 0, %s, 2, CURRENT_TIMESTAMP)",
                    (entry_id, acct['2300'], f"Salaires a payer {mois_str}", cout),
                )
                labor_created += 1

        return {
            "message": f"Sync depenses: {bc_created} BC + {labor_created} main-oeuvre",
            "bc_synced": bc_created,
            "labor_synced": labor_created,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("sync_depenses_journal_entries error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la synchronisation des depenses")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# GRAND LIVRE (General Ledger)
# ============================================

@router.get("/ledger")
async def get_ledger(
    user: ErpUser = Depends(get_current_user),
    compte_code: str = Query(...),
    date_debut: Optional[str] = None,
    date_fin: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """Get transaction history for a specific account with running balance."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres = ["jl.compte_code = %s", "je.statut = 'VALIDEE'"]
        params = [compte_code]
        if date_debut:
            wheres.append("je.date_ecriture >= %s")
            params.append(date_debut)
        if date_fin:
            wheres.append("je.date_ecriture <= %s")
            params.append(date_fin)
        w = " AND ".join(wheres)
        cursor.execute(
            f"SELECT COUNT(*) as total FROM journal_lines jl "
            f"JOIN journal_entries je ON je.id = jl.journal_entry_id "
            f"WHERE {w}",
            params,
        )
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT jl.id, jl.journal_entry_id, je.numero_ecriture, "
            f"je.date_ecriture, jl.libelle, jl.debit, jl.credit, "
            f"SUM(jl.debit - jl.credit) OVER (ORDER BY je.date_ecriture, jl.id) as solde_cumulatif "
            f"FROM journal_lines jl "
            f"JOIN journal_entries je ON je.id = jl.journal_entry_id "
            f"WHERE {w} "
            f"ORDER BY je.date_ecriture, jl.id "
            f"LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("date_ecriture"):
                d["date_ecriture"] = str(d["date_ecriture"])
            for k in ("debit", "credit", "solde_cumulatif"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        return {
            "compte_code": compte_code,
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_ledger error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/ledger/accounts")
async def get_ledger_accounts(user: ErpUser = Depends(get_current_user)):
    """Get all accounts with computed balances from validated entries."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT pc.id, pc.code, pc.nom, pc.type, pc.classe, pc.solde_normal, "
            "COALESCE(SUM(jl.debit), 0) as total_debit, "
            "COALESCE(SUM(jl.credit), 0) as total_credit, "
            "CASE WHEN UPPER(pc.solde_normal) IN ('D', 'DEBIT') "
            "  THEN COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) "
            "  ELSE COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0) "
            "END as solde "
            "FROM plan_comptable pc "
            "LEFT JOIN (journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.statut = 'VALIDEE') ON jl.compte_code = pc.code "
            "WHERE pc.actif = TRUE "
            "GROUP BY pc.id, pc.code, pc.nom, pc.type, pc.classe, pc.solde_normal "
            "ORDER BY pc.code"
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("total_debit", "total_credit", "solde"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_ledger_accounts error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/trial-balance")
async def get_trial_balance(
    user: ErpUser = Depends(get_current_user),
    date_fin: Optional[str] = None,
):
    """Get trial balance (balance de verification)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        date_filter = ""
        params = []
        if date_fin:
            date_filter = "AND je.date_ecriture <= %s"
            params.append(date_fin)
        cursor.execute(
            f"SELECT pc.id, pc.code, pc.nom, pc.type, pc.classe, pc.solde_normal, "
            f"COALESCE(SUM(jl.debit), 0) as total_debit, "
            f"COALESCE(SUM(jl.credit), 0) as total_credit, "
            f"CASE WHEN UPPER(pc.solde_normal) IN ('D', 'DEBIT') "
            f"  THEN COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) "
            f"  ELSE COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0) "
            f"END as solde "
            f"FROM plan_comptable pc "
            f"LEFT JOIN (journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.statut = 'VALIDEE') ON jl.compte_code = pc.code "
            f"WHERE pc.actif = TRUE {date_filter} "
            f"GROUP BY pc.id, pc.code, pc.nom, pc.type, pc.classe, pc.solde_normal "
            f"HAVING COALESCE(SUM(jl.debit), 0) != 0 OR COALESCE(SUM(jl.credit), 0) != 0 "
            f"ORDER BY pc.code",
            params,
        )
        items = []
        grand_total_debit = 0.0
        grand_total_credit = 0.0
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("total_debit", "total_credit", "solde"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            grand_total_debit += d["total_debit"]
            grand_total_credit += d["total_credit"]
            items.append(d)
        return {
            "items": items,
            "total": len(items),
            "grand_total_debit": round(grand_total_debit, 2),
            "grand_total_credit": round(grand_total_credit, 2),
            "is_balanced": abs(grand_total_debit - grand_total_credit) < 0.01,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_trial_balance error: %s", exc)
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
# ETATS FINANCIERS (Financial Statements)
# ============================================

@router.get("/balance-sheet")
async def get_balance_sheet(
    user: ErpUser = Depends(get_current_user),
    date_fin: Optional[str] = None,
):
    """Generate balance sheet (bilan)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        date_filter = ""
        params = []
        if date_fin:
            date_filter = "AND je.date_ecriture <= %s"
            params.append(date_fin)
        # Pull Classe 1 (actifs), 2 (passifs), 3 (capital), 4 (revenus),
        # 5 (couts directs) et 6 (frais exploitation) en une passe pour
        # calculer le résultat net exercice et l'ajouter aux capitaux
        # propres (sinon le bilan n'est jamais équilibré tant qu'un
        # exercice n'est pas clôturé). Classes 5 et 6 agrégées ensemble
        # dans `total_charges` — cohérent avec `/income-statement` et
        # `/cost-of-goods-sold` qui séparent mais additionnent pour le
        # résultat net.
        cursor.execute(
            f"SELECT pc.code, pc.nom, pc.classe, pc.solde_normal, "
            f"COALESCE(SUM(jl.debit), 0) as total_debit, "
            f"COALESCE(SUM(jl.credit), 0) as total_credit "
            f"FROM plan_comptable pc "
            f"LEFT JOIN (journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.statut = 'VALIDEE') ON jl.compte_code = pc.code "
            f"WHERE pc.actif = TRUE AND pc.classe IN (1,2,3,4,5,6) {date_filter} "
            f"GROUP BY pc.code, pc.nom, pc.classe, pc.solde_normal "
            f"HAVING COALESCE(SUM(jl.debit), 0) != 0 OR COALESCE(SUM(jl.credit), 0) != 0 "
            f"ORDER BY pc.code",
            params,
        )
        actifs_court_terme = []
        actifs_long_terme = []
        passifs_court_terme = []
        passifs_long_terme = []
        capitaux = []
        total_revenus = 0.0
        total_charges = 0.0
        for row in cursor.fetchall():
            d = dict(row)
            td = float(d["total_debit"])
            tc = float(d["total_credit"])
            sn = (d.get("solde_normal") or "").upper()
            classe = d.get("classe")
            if sn in ("D", "DEBIT"):
                d["solde"] = round(td - tc, 2)
            else:
                d["solde"] = round(tc - td, 2)
            # Contra-accounts: a CREDIT balance on an asset account (class 1)
            # or a DEBIT balance on a liability account (class 2) reduces the
            # category total. Example: compte 1510 "Amortissement cumule"
            # is a contra-asset — its positive credit balance must be
            # subtracted from total_actifs to match the income statement
            # which already includes the amortization charge in resultat_net.
            if classe == 1 and sn in ("C", "CREDIT"):
                d["solde"] = round(-d["solde"], 2)
            elif classe == 2 and sn in ("D", "DEBIT"):
                d["solde"] = round(-d["solde"], 2)
            d["total_debit"] = td
            d["total_credit"] = tc
            code = str(d["code"])
            first_two = int(code[:2]) if len(code) >= 2 and code[:2].isdigit() else 0
            if classe == 1:
                if first_two <= 14:
                    actifs_court_terme.append(d)
                else:
                    actifs_long_terme.append(d)
            elif classe == 2:
                if first_two <= 25:
                    passifs_court_terme.append(d)
                else:
                    passifs_long_terme.append(d)
            elif classe == 3:
                capitaux.append(d)
            elif classe == 4:
                total_revenus += d["solde"]
            elif classe == 5 or classe == 6:
                # Classe 5 = couts directs (contrats), Classe 6 = frais
                # exploitation (admin). Les 2 participent au résultat net.
                total_charges += d["solde"]

        # Résultat net exercice = Revenus − Charges. Injecté en capitaux
        # propres pour équilibrer le bilan d'un exercice non clôturé.
        resultat_net = round(total_revenus - total_charges, 2)
        if resultat_net != 0:
            capitaux.append({
                "code": "RES_NET",
                "nom": "Resultat net exercice (Revenus - Charges)",
                "classe": 3,
                "solde_normal": "C",
                "total_debit": round(total_charges, 2),
                "total_credit": round(total_revenus, 2),
                "solde": resultat_net,
            })

        total_actifs_ct = round(sum(a["solde"] for a in actifs_court_terme), 2)
        total_actifs_lt = round(sum(a["solde"] for a in actifs_long_terme), 2)
        total_actifs = round(total_actifs_ct + total_actifs_lt, 2)
        total_passifs_ct = round(sum(p["solde"] for p in passifs_court_terme), 2)
        total_passifs_lt = round(sum(p["solde"] for p in passifs_long_terme), 2)
        total_passifs = round(total_passifs_ct + total_passifs_lt, 2)
        total_capitaux = round(sum(c["solde"] for c in capitaux), 2)
        total_passifs_capitaux = round(total_passifs + total_capitaux, 2)
        return {
            "date_fin": date_fin or str(date.today()),
            "actifs_court_terme": actifs_court_terme,
            "total_actifs_court_terme": total_actifs_ct,
            "actifs_long_terme": actifs_long_terme,
            "total_actifs_long_terme": total_actifs_lt,
            "total_actifs": total_actifs,
            "passifs_court_terme": passifs_court_terme,
            "total_passifs_court_terme": total_passifs_ct,
            "passifs_long_terme": passifs_long_terme,
            "total_passifs_long_terme": total_passifs_lt,
            "total_passifs": total_passifs,
            "capitaux": capitaux,
            "total_capitaux": total_capitaux,
            "total_revenus": round(total_revenus, 2),
            "total_charges": round(total_charges, 2),
            "resultat_net_exercice": resultat_net,
            "total_passifs_et_capitaux": total_passifs_capitaux,
            "is_balanced": abs(total_actifs - total_passifs_capitaux) < 0.01,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_balance_sheet error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/income-statement")
async def get_income_statement(
    user: ErpUser = Depends(get_current_user),
    date_debut: Optional[str] = None,
    date_fin: Optional[str] = None,
):
    """Generate income statement (etat des resultats)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        date_filters = []
        params = []
        if date_debut:
            date_filters.append("AND je.date_ecriture >= %s")
            params.append(date_debut)
        if date_fin:
            date_filters.append("AND je.date_ecriture <= %s")
            params.append(date_fin)
        date_clause = " ".join(date_filters)
        cursor.execute(
            f"SELECT pc.code, pc.nom, pc.classe, pc.solde_normal, "
            f"COALESCE(SUM(jl.debit), 0) as total_debit, "
            f"COALESCE(SUM(jl.credit), 0) as total_credit "
            f"FROM plan_comptable pc "
            f"LEFT JOIN (journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.statut = 'VALIDEE') ON jl.compte_code = pc.code "
            f"WHERE pc.actif = TRUE AND pc.classe IN (4,5,6) {date_clause} "
            f"GROUP BY pc.code, pc.nom, pc.classe, pc.solde_normal "
            f"HAVING COALESCE(SUM(jl.debit), 0) != 0 OR COALESCE(SUM(jl.credit), 0) != 0 "
            f"ORDER BY pc.code",
            params,
        )
        revenus = []
        couts_contrats = []
        frais_exploitation = []
        for row in cursor.fetchall():
            d = dict(row)
            td = float(d["total_debit"])
            tc = float(d["total_credit"])
            sn = (d.get("solde_normal") or "").upper()
            if sn in ("D", "DEBIT"):
                d["solde"] = round(td - tc, 2)
            else:
                d["solde"] = round(tc - td, 2)
            d["total_debit"] = td
            d["total_credit"] = tc
            classe = d.get("classe")
            if classe == 4:
                revenus.append(d)
            elif classe == 5:
                couts_contrats.append(d)
            elif classe == 6:
                frais_exploitation.append(d)
        total_revenus = round(sum(r["solde"] for r in revenus), 2)
        total_couts = round(sum(c["solde"] for c in couts_contrats), 2)
        marge_brute = round(total_revenus - total_couts, 2)
        total_frais = round(sum(f["solde"] for f in frais_exploitation), 2)
        resultat_net = round(marge_brute - total_frais, 2)
        return {
            "date_debut": date_debut,
            "date_fin": date_fin or str(date.today()),
            "revenus": revenus,
            "total_revenus": total_revenus,
            "couts_contrats": couts_contrats,
            "total_couts_contrats": total_couts,
            "marge_brute": marge_brute,
            "frais_exploitation": frais_exploitation,
            "total_frais_exploitation": total_frais,
            "resultat_net": resultat_net,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_income_statement error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/cash-flow")
async def get_cash_flow(
    user: ErpUser = Depends(get_current_user),
    date_debut: Optional[str] = None,
    date_fin: Optional[str] = None,
):
    """Get cash flow summary by month."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        date_filters = []
        params = []
        if date_debut:
            date_filters.append("AND je.date_ecriture >= %s")
            params.append(date_debut)
        if date_fin:
            date_filters.append("AND je.date_ecriture <= %s")
            params.append(date_fin)
        date_clause = " ".join(date_filters)
        cursor.execute(
            f"SELECT date_trunc('month', je.date_ecriture) as mois, "
            f"COALESCE(SUM(jl.debit), 0) as entrees, "
            f"COALESCE(SUM(jl.credit), 0) as sorties, "
            f"COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as net "
            f"FROM journal_lines jl "
            f"JOIN journal_entries je ON je.id = jl.journal_entry_id "
            f"WHERE (jl.compte_code LIKE '10%%' OR jl.compte_code LIKE '11%%') AND je.statut = 'VALIDEE' "
            f"{date_clause} "
            f"GROUP BY date_trunc('month', je.date_ecriture) "
            f"ORDER BY mois",
            params,
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("mois"):
                d["mois"] = str(d["mois"])
            for k in ("entrees", "sorties", "net"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_cash_flow error: %s", exc)
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
# CENTRES DE COUTS (Cost Centers)
# ============================================

class PeriodCreate(BaseModel):
    nom: Optional[str] = None
    annee_fiscale: int
    periode: int
    date_debut: str
    date_fin: str


class CostCenterCreate(BaseModel):
    code: str
    nom: str
    type: str = "PRODUCTION"
    description: Optional[str] = None
    budget_annuel: Optional[float] = None


def _ensure_cost_centers_table(cursor):
    """Create cost_centers table if it doesn't exist."""
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS cost_centers (
                id SERIAL PRIMARY KEY,
                code VARCHAR(20) UNIQUE NOT NULL,
                nom VARCHAR(200) NOT NULL,
                type VARCHAR(50) DEFAULT 'PRODUCTION',
                description TEXT,
                budget_annuel NUMERIC(14,2) DEFAULT 0,
                actif BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
    except Exception as exc:
        logger.warning("_ensure cost_centers: %s", exc)
        pass


@router.get("/cost-centers")
async def list_cost_centers(user: ErpUser = Depends(get_current_user)):
    """List all cost centers."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_cost_centers_table(cursor)
        cursor.execute(
            "SELECT id, code, nom, type, description, budget_annuel, "
            "actif, created_at, updated_at "
            "FROM cost_centers WHERE actif = TRUE "
            "ORDER BY code ASC"
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("created_at", "updated_at"):
                if d.get(k):
                    d[k] = str(d[k])
            if d.get("budget_annuel") is not None:
                d["budget_annuel"] = float(d["budget_annuel"])
            items.append(d)
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_cost_centers error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/cost-centers")
async def create_cost_center(body: CostCenterCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new cost center."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_cost_centers_table(cursor)
        cursor.execute(
            "INSERT INTO cost_centers (code, nom, type, description, budget_annuel, "
            "created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
            (body.code, body.nom, body.type, body.description,
             body.budget_annuel or 0),
        )
        row = cursor.fetchone()
        return {"id": row["id"], "code": body.code, "message": "Centre de coûts créé"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_cost_center error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/cost-centers/summary")
async def get_cost_centers_summary(user: ErpUser = Depends(get_current_user)):
    """Get aggregated summary by cost center."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_cost_centers_table(cursor)
        cursor.execute(
            "SELECT cc.id, cc.code, cc.nom, cc.type, cc.budget_annuel, "
            "COALESCE(SUM(jl.debit), 0) as total_debit, "
            "COALESCE(SUM(jl.credit), 0) as total_credit, "
            "COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as solde "
            "FROM cost_centers cc "
            "LEFT JOIN (journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.statut = 'VALIDEE') ON jl.centre_cout_id = cc.id "
            "WHERE cc.actif = TRUE "
            "GROUP BY cc.id, cc.code, cc.nom, cc.type, cc.budget_annuel "
            "ORDER BY cc.code"
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("budget_annuel", "total_debit", "total_credit", "solde"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_cost_centers_summary error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/cost-centers/{center_id}/transactions")
async def get_cost_center_transactions(
    center_id: int,
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """Get transactions for a cost center from journal_lines."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) as total FROM journal_lines WHERE centre_cout_id = %s",
            (center_id,),
        )
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            "SELECT jl.id, jl.journal_entry_id, je.numero_ecriture, je.date_ecriture, "
            "jl.compte_code, jl.libelle, jl.debit, jl.credit "
            "FROM journal_lines jl "
            "JOIN journal_entries je ON je.id = jl.journal_entry_id "
            "WHERE jl.centre_cout_id = %s "
            "ORDER BY je.date_ecriture DESC, jl.id DESC "
            "LIMIT %s OFFSET %s",
            (center_id, per_page, offset),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("date_ecriture"):
                d["date_ecriture"] = str(d["date_ecriture"])
            for k in ("debit", "credit"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        return {
            "center_id": center_id,
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_cost_center_transactions error: %s", exc)
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
# FACTURE LIGNES + PAIEMENTS
# ============================================

class InvoiceLineCreate(BaseModel):
    description: str
    quantite: float = Field(1, ge=0)
    prix_unitaire: float = Field(0, ge=0)


class InvoiceLineUpdate(BaseModel):
    description: Optional[str] = None
    quantite: Optional[float] = Field(None, ge=0)
    prix_unitaire: Optional[float] = Field(None, ge=0)


class InvoicePayment(BaseModel):
    montant: float = Field(..., gt=0)
    date_paiement: Optional[str] = None
    mode_paiement: Optional[str] = None
    reference: Optional[str] = None

    @field_validator("date_paiement", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class InvoiceSendRequest(BaseModel):
    """Envoi d'une facture par courriel avec PDF en piece jointe.

    `to_email` est obligatoire (pas d'inference silencieuse depuis client_email
    pour eviter envois accidentels a des adresses obsoletes). `cc`/`bcc`
    acceptent des adresses separees par virgules. `subject_override` et
    `message_override` permettent au user de personnaliser l'envoi sans
    toucher au template global (qui reste utilise comme default).

    Note: a l'envoi, snapshot fige emetteur (nom/adresse/RBQ/TPS/TVQ) et
    client (nom/adresse/TPS/TVQ) sur la facture pour preserver la conformite
    Revenu Quebec meme si la config tenant change apres l'envoi.
    """
    to_email: str = Field(..., min_length=3, max_length=255)
    cc: Optional[str] = None
    bcc: Optional[str] = None
    subject_override: Optional[str] = Field(None, max_length=255)
    message_override: Optional[str] = Field(None, max_length=5000)

    @field_validator("to_email", "cc", "bcc", "subject_override")
    @classmethod
    def _no_crlf(cls, v):
        # CRLF guard sur subject_override aussi (defense-in-depth pour les
        # headers SMTP; le helper _send_smtp_internal le revalide mais on
        # echoue plus tot avec un 422 clair plutot qu'un 502).
        if v and ("\r" in v or "\n" in v):
            raise ValueError("Caractere de saut de ligne interdit")
        return v

    @field_validator("to_email")
    @classmethod
    def _validate_email_format(cls, v):
        # Validation regex stricte: refuse "garbage", "a@", "@b", display
        # name format "User <test@x.com>", caracteres de controle (ZWSP, etc.)
        # Plus permissive qu'EmailStr (pas de DNS check) mais bloque les cas
        # evidents de typo qui mèneraient à un échec SMTP en aval.
        import re as _re_email
        if not v:
            raise ValueError("Adresse courriel obligatoire")
        # Caracteres de controle invisibles (ZWSP, NBSP, etc.)
        if any(ord(c) < 32 or ord(c) == 127 or ord(c) in (0x200B, 0x200C, 0x200D, 0xA0) for c in v):
            raise ValueError("Caracteres invisibles non autorises dans l'adresse")
        # Format basique: local-part@domain.tld
        pattern = r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
        if not _re_email.match(pattern, v.strip()):
            raise ValueError(
                f"Format d'adresse courriel invalide: '{v}'. "
                "Attendu: local@domaine.tld (sans nom d'affichage ni chevrons)"
            )
        return v.strip()


class RecurringInvoiceLine(BaseModel):
    """Une ligne du template de facture recurrente."""
    description: str = Field(..., min_length=1, max_length=500)
    quantite: float = Field(1.0, ge=0)
    prix_unitaire: float = Field(0.0, ge=0)
    unite: Optional[str] = "unite"


class RecurringInvoiceCreate(BaseModel):
    """Creation d'un template de facture recurrente.

    `frequence` accepte: hebdomadaire, bimensuel, mensuel, bimestriel,
    trimestriel, semestriel, annuel. `interval_count` permet de multiplier
    (ex: frequence=mensuel + interval_count=3 -> tous les 3 mois).

    `date_debut` est la date de la PREMIERE generation. La prochaine date
    est calculee a partir de la. `date_fin` (optionnelle) coupe la
    recurrence apres cette date. `nb_occurrences_max` est une autre
    facon de borner.

    `statut_facture_genere` controle l'etat des factures generees:
    - BROUILLON (defaut): user doit envoyer manuellement
    - ENVOYEE: facture automatiquement basculee ENVOYEE et ecriture
      comptable creee. Combine avec `auto_envoi_email=True` pour
      envoyer le PDF par courriel automatiquement.
    """
    nom: str = Field(..., min_length=3, max_length=200)
    client_company_id: int = Field(..., gt=0)
    project_id: Optional[int] = None
    frequence: str = Field("mensuel")
    interval_count: int = Field(1, ge=1, le=12)
    date_debut: str
    date_fin: Optional[str] = None
    nb_occurrences_max: Optional[int] = Field(None, ge=1, le=1000)
    statut_facture_genere: str = Field("BROUILLON")
    auto_envoi_email: bool = False
    email_destinataire: Optional[str] = None
    conditions_paiement: str = Field("Net 30", max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)
    notes_internes: Optional[str] = Field(None, max_length=2000)
    lignes: list[RecurringInvoiceLine] = Field(..., min_length=1, max_length=200)

    @field_validator("date_debut", "date_fin", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

    @field_validator("frequence")
    @classmethod
    def _validate_frequence(cls, v):
        if v not in VALID_FREQUENCES:
            raise ValueError(
                f"Frequence invalide: {v}. Valides: {', '.join(sorted(VALID_FREQUENCES))}"
            )
        return v

    @field_validator("statut_facture_genere")
    @classmethod
    def _validate_statut(cls, v):
        if v not in ("BROUILLON", "ENVOYEE"):
            raise ValueError("statut_facture_genere doit etre BROUILLON ou ENVOYEE")
        return v

    @field_validator("email_destinataire")
    @classmethod
    def _validate_create_email(cls, v):
        # FIX P2 (J1): valider email_destinataire au create (etait laxiste —
        # acceptait n'importe quoi, validation seulement au moment SMTP).
        if v is None or not v.strip():
            return v
        import re as _re_em_c
        if "\r" in v or "\n" in v:
            raise ValueError("CRLF interdit dans l'adresse")
        pattern = r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
        if not _re_em_c.match(pattern, v.strip()):
            raise ValueError(f"Format courriel invalide: {v}")
        return v.strip()


class RecurringInvoiceUpdate(BaseModel):
    """Modification partielle d'un template. Tous champs optionnels."""
    nom: Optional[str] = Field(None, min_length=3, max_length=200)
    client_company_id: Optional[int] = Field(None, gt=0)
    project_id: Optional[int] = None
    frequence: Optional[str] = None
    interval_count: Optional[int] = Field(None, ge=1, le=12)
    date_fin: Optional[str] = None
    nb_occurrences_max: Optional[int] = Field(None, ge=1, le=1000)
    statut_facture_genere: Optional[str] = None
    auto_envoi_email: Optional[bool] = None
    email_destinataire: Optional[str] = Field(None, max_length=255)
    conditions_paiement: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)
    notes_internes: Optional[str] = Field(None, max_length=2000)
    lignes: Optional[list[RecurringInvoiceLine]] = None
    prochaine_date: Optional[str] = None  # permet d'ajuster manuellement

    @field_validator("date_fin", "prochaine_date", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)

    @field_validator("prochaine_date")
    @classmethod
    def _validate_prochaine_date_not_past(cls, v):
        # FIX P1 (S10): empecher de mettre prochaine_date dans le passe.
        # Sans cette validation, un user authentifie pourrait set
        # prochaine_date="2020-01-01" et forcer une generation immediate
        # de centaines de factures spam au prochain cron.
        if v is None:
            return v
        try:
            d = datetime.strptime(v[:10], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            raise ValueError(f"Format date invalide: {v} (YYYY-MM-DD attendu)")
        # Tolerer aujourd'hui meme et le futur. Refuser le passe strict.
        # Utilise _today_quebec() pour eviter edge case minuit EDT.
        try:
            from zoneinfo import ZoneInfo
            _today = datetime.now(ZoneInfo("America/Toronto")).date()
        except Exception:
            from datetime import date as _date_cls
            _today = _date_cls.today()
        if d < _today:
            raise ValueError(
                f"prochaine_date={v} est dans le passe. Utilisez generate-now "
                "pour rattraper, ou choisissez une date >= aujourd'hui."
            )
        return v

    @field_validator("email_destinataire")
    @classmethod
    def _validate_update_email(cls, v):
        # Validation regex sur update aussi (le create avait le validator,
        # mais ce champ etait laxiste sur l'update — defense profondeur).
        if v is None or not v.strip():
            return v
        import re as _re_em_u
        if "\r" in v or "\n" in v:
            raise ValueError("CRLF interdit dans l'adresse")
        pattern = r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
        if not _re_em_u.match(pattern, v.strip()):
            raise ValueError(f"Format courriel invalide: {v}")
        return v.strip()


class ReminderSendRequest(BaseModel):
    """Envoi manuel d'un rappel de paiement.

    `niveau` 1-4 mappe sur J+3/J+15/J+30/J+60. Le niveau detail le ton
    (courtois -> mise en demeure). `to_email_override` permet d'envoyer
    a une autre adresse que celle du client (ex: comptabilite distincte).
    """
    niveau: int = Field(..., ge=1, le=4)
    to_email_override: Optional[str] = Field(None, max_length=255)
    message_override: Optional[str] = Field(None, max_length=5000)
    auto: bool = False  # marque le rappel comme auto-genere (cron)

    @field_validator("to_email_override")
    @classmethod
    def _validate_email_format(cls, v):
        if v is None:
            return v
        import re as _re_em
        if "\r" in v or "\n" in v:
            raise ValueError("CRLF interdit dans l'adresse")
        pattern = r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
        if not _re_em.match(pattern, v.strip()):
            raise ValueError(f"Format courriel invalide: {v}")
        return v.strip()


class CreditNoteCreate(BaseModel):
    """Creation d'une note de credit (AVOIR) referencant une facture origine.

    Mode `montant_total`: cree un AVOIR global pour un montant fixe (ex.
    remise commerciale). Mode `lignes` (futur): cree un AVOIR par ligne
    avec quantites et montants individuels. Si ni `montant_total` ni
    `lignes` ne sont fournis, l'AVOIR est cree avec le montant complet
    de la facture origine (annulation totale).
    """
    raison: str = Field(..., min_length=3, max_length=500)
    montant_total: Optional[float] = Field(None, gt=0)
    date_avoir: Optional[str] = None
    notes_internes: Optional[str] = None

    @field_validator("date_avoir", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


def _ensure_facture_lignes_table(cursor):
    """Create facture_lignes table if it doesn't exist."""
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS facture_lignes (
                id SERIAL PRIMARY KEY,
                facture_id INTEGER NOT NULL,
                description TEXT,
                quantite NUMERIC(10,3) DEFAULT 1,
                unite TEXT DEFAULT 'unite',
                prix_unitaire NUMERIC(12,2) DEFAULT 0,
                montant NUMERIC(12,2) DEFAULT 0,
                montant_ligne NUMERIC(12,2) DEFAULT 0,
                sequence_ligne INTEGER DEFAULT 0,
                categorie TEXT,
                notes TEXT,
                date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
    except Exception as exc:
        logger.warning("_ensure facture_lignes: %s", exc)
        pass


def _ensure_facture_compliance_columns(cursor):
    """Ajoute les colonnes de conformite/traceabilite aux factures.

    Idempotent: utilise ALTER TABLE IF NOT EXISTS pour chaque colonne. A
    appeler au debut des endpoints d'envoi/avoir pour garantir que les
    tenants legacy beneficient des nouvelles colonnes sans migration
    coordonnee. Pattern coherent avec _ensure_facture_lignes_table.

    Colonnes ajoutees:
    - emetteur_snapshot JSONB: nom/adresse/RBQ/TPS/TVQ figes a l'envoi
      (conformite Revenu Quebec: l'emetteur affiche sur la facture
      imprimee doit refleter l'etat de l'entreprise au moment de l'envoi,
      pas l'etat actuel).
    - client_snapshot JSONB: nom/adresse/TPS/TVQ destinataire figes
    - type_document TEXT: 'FACTURE', 'AVOIR' (note credit), 'ACOMPTE',
      'PROFORMA' — defaut 'FACTURE'
    - facture_origine_id INTEGER: pour les AVOIR, refere la facture
      originale (norme TPS/TVQ Revenu Quebec art. 350 LTVQ)
    - date_envoi TIMESTAMP: horodatage du premier envoi
    - envoye_par TEXT: email du user qui a envoye
    - envoye_a TEXT: email destinataire reel utilise lors de l'envoi
    - motif_avoir TEXT: raison de la note de credit
    """
    cols = [
        ("emetteur_snapshot", "JSONB"),
        ("client_snapshot", "JSONB"),
        ("type_document", "TEXT DEFAULT 'FACTURE'"),
        ("facture_origine_id", "INTEGER"),
        ("facture_origine_numero", "TEXT"),
        ("date_envoi", "TIMESTAMP"),
        ("envoye_par", "TEXT"),
        ("envoye_a", "TEXT"),
        ("motif_avoir", "TEXT"),
    ]
    for col_name, col_type in cols:
        try:
            cursor.execute(
                f"ALTER TABLE factures ADD COLUMN IF NOT EXISTS {col_name} {col_type}"
            )
        except Exception as exc:
            logger.debug("_ensure facture compliance col %s skipped: %s", col_name, exc)

    # Index pour performance: cumul avoirs par facture origine
    try:
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_factures_origine "
            "ON factures(facture_origine_id) WHERE facture_origine_id IS NOT NULL"
        )
    except Exception as exc:
        logger.debug("_ensure idx_factures_origine skipped: %s", exc)

    # Backfill one-shot: les AVOIRs legacy (crees avant `facture_origine_numero`)
    # ont cette colonne NULL et le PDF affiche `#<id>` au lieu du numero fiscal.
    # Conformite Revenu Quebec art. 350 LTVQ: la note de credit DOIT referer
    # le numero de facture, pas un ID technique. Cet UPDATE rattrape les
    # avoirs existants en allant chercher le numero dans la facture origine.
    # Idempotent: ne touche que les rows ou la colonne est NULL.
    try:
        cursor.execute(
            "UPDATE factures f SET facture_origine_numero = origin.numero_facture "
            "FROM factures origin "
            "WHERE f.facture_origine_id = origin.id "
            "AND f.type_document = 'AVOIR' "
            "AND f.facture_origine_numero IS NULL "
            "AND origin.numero_facture IS NOT NULL"
        )
    except Exception as exc:
        logger.debug("_ensure backfill facture_origine_numero skipped: %s", exc)


def _safe_url_fetcher(url, timeout=None, ssl_context=None):
    """URL fetcher pour WeasyPrint qui REFUSE toutes les URLs externes.

    Protection SSRF: sans ce fetcher, WeasyPrint suit par defaut les URLs
    `<img src="https://...">`, `<link>`, `@import url()`, etc. Sur Render,
    un user malveillant pourrait injecter `<img src="http://169.254.169.254/...">`
    dans une description et exfiltrer les credentials cloud metadata.

    On accepte uniquement les data: URIs (images embedded base64) qui sont
    inoffensives.
    """
    if isinstance(url, str) and url.startswith("data:"):
        # Laisse WeasyPrint gerer le data: URI nativement en retournant None
        # n'est pas accepte; on doit retourner un dict avec string/mime_type.
        # Solution: faire le fetch nous-meme pour data: URIs.
        try:
            import base64 as _b64
            from urllib.parse import unquote
            header, payload = url.split(",", 1)
            mime_part = header[5:]  # strip "data:"
            is_b64 = ";base64" in mime_part
            mime_type = mime_part.split(";", 1)[0] or "application/octet-stream"
            data = _b64.b64decode(payload) if is_b64 else unquote(payload).encode("utf-8")
            return {"string": data, "mime_type": mime_type}
        except Exception:
            return {"string": b"", "mime_type": "text/plain"}
    # Toute autre URL (http/https/file/etc.) -> vide
    return {"string": b"", "mime_type": "text/plain"}


def _generate_invoice_pdf(html_str: str, timeout_sec: float = 30.0) -> bytes:
    """Convertit le HTML facture en PDF via WeasyPrint.

    WeasyPrint supporte les features modernes (flexbox, grid, gradients,
    @media print) utilisees par _generate_facture_html. Sur Render
    (Linux), les dependances natives (Pango, Cairo) sont disponibles
    via les wheels Python.

    Securite SSRF: utilise _safe_url_fetcher qui refuse toutes les URLs
    externes (HTTP/HTTPS/file/etc.) pour eviter l'exfiltration de metadata
    cloud via injection HTML user.

    Protection DoS: `timeout_sec` (defaut 30s) borne le rendu. Un HTML
    pathologique (boucles CSS, gradients complexes, milliers de lignes)
    serait sinon capable de bloquer un worker FastAPI indefiniment.
    Implementation via signal SIGALRM (Linux/Mac) en thread principal
    OU via ThreadPoolExecutor avec timeout pour les workers FastAPI.

    Raises HTTPException 500 si WeasyPrint indisponible/echec, 408 si timeout.
    """
    try:
        from weasyprint import HTML as _WPHtml
    except ImportError as exc:
        logger.error("WeasyPrint non disponible: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=(
                "Generation PDF indisponible — module WeasyPrint non installe "
                "sur le serveur. Contactez le support."
            ),
        )

    # Wrap rendu dans un ThreadPoolExecutor avec timeout (compatible workers
    # asyncio FastAPI; SIGALRM ne fonctionne pas en thread non-main).
    import concurrent.futures
    import threading

    def _render():
        return _WPHtml(string=html_str, url_fetcher=_safe_url_fetcher).write_pdf()

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_render)
            try:
                return future.result(timeout=timeout_sec)
            except concurrent.futures.TimeoutError:
                logger.error(
                    "WeasyPrint timeout (%.0fs) — HTML potentiellement pathologique",
                    timeout_sec,
                )
                raise HTTPException(
                    status_code=408,
                    detail=(
                        f"Generation PDF trop longue (depasse {int(timeout_sec)}s). "
                        "Reduisez le nombre de lignes ou contactez le support."
                    ),
                )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("WeasyPrint rendu echoue: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Echec generation PDF — verifiez le HTML de la facture.",
        )


def _build_emetteur_snapshot(enterprise: dict) -> dict:
    """Construit le snapshot JSON-safe de l'emetteur a figer sur la facture.

    Utilise par /send pour preserver la conformite Revenu Quebec: la
    facture imprimee doit refleter l'etat de l'entreprise au moment de
    l'envoi, meme si la config tenant change ulterieurement.
    """
    if not enterprise:
        return {}
    return {
        "nom": enterprise.get("nom", ""),
        "adresse": enterprise.get("adresse", ""),
        "ville": enterprise.get("ville", ""),
        "province": enterprise.get("province", ""),
        "code_postal": enterprise.get("code_postal", ""),
        "telephone": enterprise.get("telephone", ""),
        "courriel": enterprise.get("courriel", ""),
        "site_web": enterprise.get("site_web", ""),
        "rbq": enterprise.get("rbq", ""),
        "neq": enterprise.get("neq", ""),
        "tps": enterprise.get("tps", ""),
        "tvq": enterprise.get("tvq", ""),
    }


def _build_client_snapshot(facture: dict, client_company: Optional[dict]) -> dict:
    """Construit le snapshot JSON-safe du destinataire (client).

    Priorise les champs explicites de la facture (saisie manuelle) sur
    ceux de companies (lien dynamique). Inclut TPS/TVQ pour conformite
    Revenu Quebec sur factures >30$.
    """
    cc = client_company or {}
    return {
        "nom": facture.get("client_nom") or cc.get("nom", ""),
        "adresse": facture.get("client_adresse") or cc.get("adresse", ""),
        "ville": facture.get("client_ville") or cc.get("ville", ""),
        "province": cc.get("province", ""),
        "code_postal": facture.get("client_code_postal") or cc.get("code_postal", ""),
        "telephone": facture.get("client_telephone") or cc.get("telephone", ""),
        "courriel": facture.get("client_email") or cc.get("email", ""),
        "tps": cc.get("numero_tps", "") or cc.get("tps", ""),
        "tvq": cc.get("numero_tvq", "") or cc.get("tvq", ""),
        "neq": cc.get("numero_neq", "") or cc.get("neq", ""),
    }


def _validate_rbq_format(rbq: str) -> bool:
    """Valide le format de licence RBQ Quebec: NNNN-NNNN-NN (10 chiffres).

    Tolere les variations: avec/sans tirets, espaces autour. Retourne True
    si le format est valide. Pour la validation officielle (actif/echu),
    appeler l'API Regie via une integration distincte (hors scope).
    """
    if not rbq or not isinstance(rbq, str):
        return False
    import re as _re
    cleaned = _re.sub(r"[\s-]", "", rbq.strip())
    return cleaned.isdigit() and len(cleaned) == 10


def _ensure_recurring_reminders_tables(cursor):
    """Cree les tables `factures_recurrentes` et `factures_rappels` + colonnes
    supplementaires sur `factures` pour le tracking des rappels.

    Idempotent: CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS.
    Appele au boot des endpoints concernes pour garantir la presence des
    tables sur les tenants legacy.

    Architecture:
    - factures_recurrentes: template (frequence, dates, lignes JSONB)
    - factures_rappels: historique J+3/15/30/60 par facture
    - Colonnes factures: rappels_actifs, dernier_rappel_le, nb_rappels_envoyes,
      facture_recurrente_id (lien vers le template si auto-generee)
    """
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS factures_recurrentes (
                id SERIAL PRIMARY KEY,
                nom TEXT NOT NULL,
                client_company_id INTEGER,
                project_id INTEGER,
                frequence TEXT NOT NULL DEFAULT 'mensuel',
                interval_count INTEGER NOT NULL DEFAULT 1,
                date_debut DATE NOT NULL,
                date_fin DATE,
                prochaine_date DATE NOT NULL,
                nb_occurrences_max INTEGER,
                nb_occurrences_generees INTEGER NOT NULL DEFAULT 0,
                derniere_generation_le TIMESTAMP,
                derniere_facture_id INTEGER,
                statut TEXT NOT NULL DEFAULT 'ACTIVE',
                statut_facture_genere TEXT NOT NULL DEFAULT 'BROUILLON',
                auto_envoi_email BOOLEAN NOT NULL DEFAULT FALSE,
                email_destinataire TEXT,
                conditions_paiement TEXT DEFAULT 'Net 30',
                notes TEXT,
                notes_internes TEXT,
                template_lignes JSONB NOT NULL DEFAULT '[]'::jsonb,
                created_by TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
    except Exception as exc:
        logger.warning("_ensure factures_recurrentes: %s", exc)

    # Indexes pour cron daily performance
    try:
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_fact_rec_active "
            "ON factures_recurrentes(prochaine_date) "
            "WHERE statut = 'ACTIVE'"
        )
    except Exception as exc:
        logger.debug("idx_fact_rec_active skipped: %s", exc)

    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS factures_rappels (
                id SERIAL PRIMARY KEY,
                facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
                niveau INTEGER NOT NULL,
                date_envoi TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                destinataire TEXT,
                sujet TEXT,
                statut TEXT NOT NULL DEFAULT 'ENVOYE',
                erreur TEXT,
                envoye_par TEXT,
                auto BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
    except Exception as exc:
        logger.warning("_ensure factures_rappels: %s", exc)

    try:
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_fact_rappels_facture "
            "ON factures_rappels(facture_id, niveau)"
        )
    except Exception as exc:
        logger.debug("idx_fact_rappels_facture skipped: %s", exc)

    # Index UNIQUE partiel pour empecher les doublons de rappels (cas extreme:
    # 2 cron daily concurrents). Le contraint sur (facture_id, niveau) pour les
    # rappels ENVOYE uniquement permet de re-tenter un niveau echoue (ECHEC).
    try:
        cursor.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_fact_rappels_niveau_envoye "
            "ON factures_rappels(facture_id, niveau) "
            "WHERE statut = 'ENVOYE'"
        )
    except Exception as exc:
        logger.debug("uq_fact_rappels_niveau_envoye skipped: %s", exc)

    # Colonnes additionnelles sur `factures` pour suivi des rappels et lien recurrence
    rappel_cols = [
        ("rappels_actifs", "BOOLEAN NOT NULL DEFAULT TRUE"),
        ("dernier_rappel_le", "TIMESTAMP"),
        ("nb_rappels_envoyes", "INTEGER NOT NULL DEFAULT 0"),
        ("facture_recurrente_id", "INTEGER"),
    ]
    for col_name, col_type in rappel_cols:
        try:
            cursor.execute(
                f"ALTER TABLE factures ADD COLUMN IF NOT EXISTS {col_name} {col_type}"
            )
        except Exception as exc:
            logger.debug("_ensure factures.%s skipped: %s", col_name, exc)

    # Index partial pour lookup rapide des factures en retard avec rappels actifs
    try:
        cursor.execute(
            "CREATE INDEX IF NOT EXISTS idx_factures_rappels_actifs "
            "ON factures(date_echeance, rappels_actifs) "
            "WHERE statut IN ('ENVOYEE', 'PARTIELLEMENT_PAYEE', 'EN_RETARD') "
            "AND rappels_actifs = TRUE"
        )
    except Exception as exc:
        logger.debug("idx_factures_rappels_actifs skipped: %s", exc)


# ============================================================
# RECURRENCE & RAPPELS — Helpers de logique metier
# ============================================================

# Niveaux de rappel: J+3, J+15, J+30, J+60 apres la date d'echeance
REMINDER_LEVELS = {
    1: {"jours_apres_echeance": 3, "ton": "courtois"},
    2: {"jours_apres_echeance": 15, "ton": "ferme"},
    3: {"jours_apres_echeance": 30, "ton": "insistant"},
    4: {"jours_apres_echeance": 60, "ton": "mise_en_demeure"},
}

# Frequences supportees: jours equivalents pour calcul next_date approximatif
# (le calcul exact utilise dateutil.relativedelta si dispo, sinon timedelta)
FREQUENCE_DAYS = {
    "hebdomadaire": 7,
    "bimensuel": 14,  # tous les 14 jours
    "mensuel": 30,
    "bimestriel": 60,
    "trimestriel": 90,
    "semestriel": 182,
    "annuel": 365,
}

VALID_FREQUENCES = set(FREQUENCE_DAYS.keys())


def _today_quebec() -> date:
    """Retourne la date courante dans la timezone America/Toronto.

    FIX P1 (T3/T13): Render serveur est en UTC. Sans cette conversion, le
    cron tournant a 23:30 EDT (= 03:30 UTC le lendemain) verrait
    `date.today()` = jour suivant — decalage d'une journee sur les
    factures generees et les rappels.

    Fallback sur date.today() si zoneinfo indisponible (Python < 3.9
    ou bug d'import).
    """
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/Toronto")).date()
    except Exception:
        return date.today()


def _compute_next_date(current_date, frequence: str, interval_count: int = 1):
    """Calcule la prochaine date d'occurrence selon la frequence.

    Utilise `dateutil.relativedelta` pour gestion correcte des fins de mois
    (mensuel sur le 31 -> 28/29/30 selon le mois suivant). Fallback timedelta
    si dateutil indisponible (devrait toujours etre present via python-dateutil
    dans requirements.txt).
    """
    if isinstance(current_date, str):
        current_date = datetime.strptime(current_date[:10], "%Y-%m-%d").date()
    elif isinstance(current_date, datetime):
        current_date = current_date.date()

    try:
        from dateutil.relativedelta import relativedelta
        if frequence == "hebdomadaire":
            delta = relativedelta(weeks=interval_count)
        elif frequence == "bimensuel":
            delta = relativedelta(weeks=2 * interval_count)
        elif frequence == "mensuel":
            delta = relativedelta(months=interval_count)
        elif frequence == "bimestriel":
            delta = relativedelta(months=2 * interval_count)
        elif frequence == "trimestriel":
            delta = relativedelta(months=3 * interval_count)
        elif frequence == "semestriel":
            delta = relativedelta(months=6 * interval_count)
        elif frequence == "annuel":
            delta = relativedelta(years=interval_count)
        else:
            raise ValueError(f"Frequence inconnue: {frequence}")
        return current_date + delta
    except ImportError:
        # Fallback timedelta (moins precis pour mensuel/annuel mais fonctionnel)
        days = FREQUENCE_DAYS.get(frequence, 30) * interval_count
        return current_date + timedelta(days=days)


def _recalculate_origin_solde_du(cursor, facture_origine_id: int) -> dict:
    """Recalcule le solde_du d'une facture origine apres changement d'un AVOIR.

    Formule: solde_du_net = montant_total - SUM(avoirs_actifs_ttc) - montant_paye.
    Met aussi a jour le statut si applicable:
    - solde_du_net <= 0.01 -> PAYEE (sauf si statut deja final ANNULEE)
    - sinon si paye > 0 -> PARTIELLEMENT_PAYEE
    - sinon laisse le statut tel quel (EN_RETARD ou ENVOYEE selon date_echeance)

    Conformite art. 350 LTVQ: une note de credit ENVOYEE reduit officiellement
    la creance client. Sans cette correction, le solde stocke reste a
    montant_total - paye, et le cron daily marque la facture EN_RETARD a tort.

    Appele depuis:
    - update_invoice quand un AVOIR transitionne BROUILLON -> ENVOYEE
    - update_invoice quand un AVOIR transitionne vers ANNULEE (re-ajoute)
    - delete_invoice avec contre-passation AVOIR
    """
    # FIX P1 (B-P1-2): SELECT FOR UPDATE pour eviter race condition avec
    # record_invoice_payment concurrent. Sans le lock, un paiement pourrait
    # s'enregistrer entre le SELECT et le UPDATE, perdant l'effet du paiement.
    cursor.execute(
        "SELECT id, montant_total, montant_ttc, montant_paye, statut, type_document "
        "FROM factures WHERE id = %s FOR UPDATE",
        (facture_origine_id,),
    )
    row = cursor.fetchone()
    if not row:
        return {"updated": False, "reason": "origine non trouvee"}
    origine = dict(row)
    if (origine.get("statut") or "").upper() in ("ANNULEE",):
        # Si la facture origine est elle-meme annulee, ne pas recalculer
        return {"updated": False, "reason": "origine annulee"}
    # FIX P1 (B-P1-1): si l'origine est elle-meme un AVOIR, ne pas recalculer.
    # Sementiquement absurde: un AVOIR n'a pas d'AVOIRs (cas P6 du brief).
    if (origine.get("type_document") or "").upper() == "AVOIR":
        return {"updated": False, "reason": "origine est un AVOIR"}

    montant_total = float(origine.get("montant_total") or origine.get("montant_ttc") or 0)
    montant_paye = float(origine.get("montant_paye") or 0)

    cursor.execute(
        "SELECT COALESCE(SUM(montant_ttc), 0) AS sum_avoirs "
        "FROM factures WHERE facture_origine_id = %s "
        "AND type_document = 'AVOIR' "
        "AND statut NOT IN ('ANNULEE', 'BROUILLON')",
        (facture_origine_id,),
    )
    sum_avoirs = float(cursor.fetchone()["sum_avoirs"] or 0)

    montant_du_net = round(montant_total - sum_avoirs - montant_paye, 2)
    solde_du_final = max(0.0, montant_du_net)

    # Determiner le nouveau statut
    current_statut = (origine.get("statut") or "").upper()
    new_statut = current_statut
    if solde_du_final <= 0.01:
        # Solde nul ou negatif (avoir > facture, rare mais possible): PAYEE
        new_statut = "PAYEE"
        solde_du_final = 0.0
    elif montant_paye > 0 and current_statut not in ("BROUILLON",):
        new_statut = "PARTIELLEMENT_PAYEE"
    # Sinon laisser ENVOYEE / EN_RETARD inchange

    cursor.execute(
        "UPDATE factures SET solde_du = %s, statut = %s, "
        "updated_at = CURRENT_TIMESTAMP WHERE id = %s",
        (solde_du_final, new_statut, facture_origine_id),
    )
    return {
        "updated": True,
        "montant_total": montant_total,
        "sum_avoirs_actifs": sum_avoirs,
        "montant_paye": montant_paye,
        "solde_du_net": solde_du_final,
        "new_statut": new_statut,
        "old_statut": current_statut,
    }


def _assert_invoice_editable(cursor, facture_id):
    """Refuse modifications de lignes si la facture n'est pas BROUILLON.

    Preserve l'integrite comptable: une facture envoyee/payee ne doit pas voir
    ses montants changer apres coup (sinon les ecritures generees deviennent
    incoherentes avec la facture). Pour annuler une facture envoyee, il faut
    passer son statut a ANNULEE via PUT /invoices/{id} et contre-passer
    l'ecriture comptable manuellement.
    """
    cursor.execute("SELECT statut FROM factures WHERE id = %s", (facture_id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Facture non trouvee")
    if row["statut"] != "BROUILLON":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Impossible de modifier les lignes d'une facture {row['statut']}. "
                "Pour ajuster, passez d'abord la facture a BROUILLON ou ANNULEE."
            ),
        )


def _recalculate_invoice(cursor, facture_id):
    """Recalculate invoice totals from lines."""
    cursor.execute(
        "SELECT COALESCE(SUM(montant), 0) as total_ht FROM facture_lignes WHERE facture_id = %s",
        (facture_id,),
    )
    total_ht = float(cursor.fetchone()["total_ht"])
    tps_val = round(total_ht * 0.05, 2)
    tvq_val = round(total_ht * 0.09975, 2)
    ttc = round(total_ht + tps_val + tvq_val, 2)
    cursor.execute(
        "UPDATE factures SET montant_ht = %s, tps = %s, montant_tps = %s, "
        "tvq = %s, montant_tvq = %s, montant_ttc = %s, montant_total = %s, "
        "solde_du = %s - COALESCE(montant_paye, 0), updated_at = CURRENT_TIMESTAMP "
        "WHERE id = %s",
        (total_ht, tps_val, tps_val, tvq_val, tvq_val, ttc, ttc, ttc, facture_id),
    )


@router.post("/invoices/{invoice_id}/lines")
async def add_invoice_line(
    invoice_id: int,
    body: InvoiceLineCreate,
    user: ErpUser = Depends(get_current_user),
):
    """Add a line to an invoice and recalculate totals."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Refuse si facture pas BROUILLON (integrite comptable, lecon QA r3)
        _assert_invoice_editable(cursor, invoice_id)
        _ensure_facture_lignes_table(cursor)
        montant = round(body.quantite * body.prix_unitaire, 2)
        # Get next sequence
        cursor.execute(
            "SELECT COALESCE(MAX(sequence_ligne), 0) + 1 as seq FROM facture_lignes WHERE facture_id = %s",
            (invoice_id,),
        )
        seq = cursor.fetchone()["seq"]
        cursor.execute(
            "INSERT INTO facture_lignes (facture_id, description, quantite, prix_unitaire, "
            "montant, montant_ligne, sequence_ligne, date_creation) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP) RETURNING id",
            (invoice_id, body.description, body.quantite, body.prix_unitaire, montant, montant, seq),
        )
        line_id = cursor.fetchone()["id"]
        _recalculate_invoice(cursor, invoice_id)
        conn.commit()
        return {"id": line_id, "montant": montant, "message": "Ligne ajoutee"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("add_invoice_line error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/invoices/{invoice_id}/lines/{line_id}")
async def update_invoice_line(
    invoice_id: int,
    line_id: int,
    body: InvoiceLineUpdate,
    user: ErpUser = Depends(get_current_user),
):
    """Update an invoice line and recalculate totals."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Refuse si facture pas BROUILLON (integrite comptable, lecon QA r3)
        _assert_invoice_editable(cursor, invoice_id)
        _ensure_facture_lignes_table(cursor)
        # Get existing line
        cursor.execute(
            "SELECT id, description, quantite, prix_unitaire FROM facture_lignes "
            "WHERE id = %s AND facture_id = %s",
            (line_id, invoice_id),
        )
        existing = cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Ligne non trouvée")
        new_desc = body.description if body.description is not None else existing["description"]
        new_qty = body.quantite if body.quantite is not None else float(existing["quantite"])
        new_price = body.prix_unitaire if body.prix_unitaire is not None else float(existing["prix_unitaire"])
        new_montant = round(new_qty * new_price, 2)
        cursor.execute(
            "UPDATE facture_lignes SET description = %s, quantite = %s, prix_unitaire = %s, "
            "montant = %s WHERE id = %s AND facture_id = %s",
            (new_desc, new_qty, new_price, new_montant, line_id, invoice_id),
        )
        _recalculate_invoice(cursor, invoice_id)
        conn.commit()
        return {"id": line_id, "montant": new_montant, "message": "Ligne mise à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("update_invoice_line error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete an invoice (BROUILLON ou ANNULEE).

    - BROUILLON: suppression directe (pas d'ecriture comptable a contre-passer).
    - ANNULEE avec ecriture(s) liee(s): contre-passation automatique des
      ecritures (debit/credit inverses, statut VALIDEE) avant suppression.
      L'original et la CP restent en BD pour l'audit trail (norme 7 ans
      Revenu Quebec). La facture est ensuite deliee puis supprimee.
    - Autres statuts: refus, l'utilisateur doit passer par ANNULEE via PUT.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        # Mode transactionnel explicite: sans cela le pool est en autocommit
        # et le SELECT FOR UPDATE ci-dessous ne tient pas le lock.
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_sync_columns(cursor)
        # SELECT FOR UPDATE: serialise les requetes concurrentes (double-clic UI,
        # appels API en parallele). Sans ce lock, deux DELETE simultanes peuvent
        # creer chacun une contre-passation = bilan fausse de 2x le montant.
        # Le lock est libere au commit/rollback.
        cursor.execute(
            "SELECT id, statut, journal_entry_id, type_document FROM factures WHERE id = %s FOR UPDATE",
            (invoice_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Facture non trouvee")
        if row["statut"] not in ("BROUILLON", "ANNULEE"):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Impossible de supprimer une facture {row['statut']}. "
                    "Passez d'abord la facture a ANNULEE via Modifier."
                ),
            )

        # Audit trail Revenu Quebec (norme 7 ans): un AVOIR (note de credit)
        # qui a quitte BROUILLON a documente officiellement un remboursement
        # client. Le check ci-dessus (BROUILLON/ANNULEE seulement) suffit
        # deja a empecher la suppression d'un AVOIR ENVOYEE/PAYEE. Pour le
        # cas ANNULEE: les ecritures journal_entries originales sont
        # contre-passees (preservees) avant le DELETE, donc l'audit trail
        # comptable reste intact meme si la ligne `factures` est supprimee.
        type_doc = (row.get("type_document") or "FACTURE").upper()

        # Conformite comptable: bloquer la suppression si des AVOIR actifs
        # referencent cette facture (FK applicative). Sinon l'AVOIR pointe
        # vers un facture_origine_id orphelin et la trace audit est cassee.
        try:
            _ensure_facture_compliance_columns(cursor)
            cursor.execute(
                "SELECT COUNT(*) AS nb FROM factures "
                "WHERE facture_origine_id = %s "
                "AND type_document = 'AVOIR' "
                "AND statut NOT IN ('ANNULEE')",
                (invoice_id,),
            )
            avoir_row = cursor.fetchone()
            if avoir_row and (avoir_row.get("nb") or 0) > 0:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Impossible de supprimer cette facture: {avoir_row['nb']} "
                        "note(s) de credit active(s) la referencent. "
                        "Annulez d'abord les notes de credit."
                    ),
                )
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("avoir check pre-suppression facture %s: %s", invoice_id, exc)

        # Contre-passation automatique pour ANNULEE avec ecritures liees.
        # On verifie aussi via source_id pour couvrir les encaissements
        # (paiement_facture) meme si journal_entry_id n'est pas peuple.
        reversed_count = 0
        if row["statut"] == "ANNULEE":
            try:
                reversed_count = _reverse_invoice_journal_entries(cursor, invoice_id, user=user)
            except HTTPException:
                # Re-raise direct: les 400 du helper (periode cloturee) doivent
                # remonter au client avec leur message clair, pas etre transformes
                # en 500 generique par le except Exception ci-dessous.
                raise
            except Exception as exc:
                logger.error("contre-passation facture %s echouee: %s", invoice_id, exc)
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Echec de la contre-passation automatique. "
                        "Contactez le support pour intervention manuelle."
                    ),
                )
        elif row.get("journal_entry_id"):
            # BROUILLON ne devrait jamais avoir d'ecriture liee — etat incoherent
            raise HTTPException(
                status_code=400,
                detail=(
                    "Etat incoherent: facture BROUILLON avec ecriture liee. "
                    "Passez la facture a ANNULEE via Modifier pour declencher "
                    "la contre-passation automatique."
                ),
            )

        # Delete lines first. Si _ensure ou DELETE leve, on remonte au except
        # global qui rollback — pas de swallow silencieux qui laisserait des
        # orphelins en BD si la table existe mais le DELETE plante (FK, lock).
        _ensure_facture_lignes_table(cursor)
        cursor.execute("DELETE FROM facture_lignes WHERE facture_id = %s", (invoice_id,))
        # FIX P2 (RG15): nettoyer le pointeur applicatif depuis les templates
        # recurrents qui pointaient vers cette facture comme derniere generation.
        # Sans ce nettoyage, derniere_facture_id pointe vers une row supprimee.
        try:
            cursor.execute(
                "UPDATE factures_recurrentes SET derniere_facture_id = NULL "
                "WHERE derniere_facture_id = %s",
                (invoice_id,),
            )
        except Exception as exc:
            logger.debug("cleanup derniere_facture_id skipped: %s", exc)
        cursor.execute("DELETE FROM factures WHERE id = %s", (invoice_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Facture non trouvee")
        # Audit trail avant commit (meme transaction que le DELETE)
        _log_accounting_action(
            cursor, user, "delete", "invoice", invoice_id,
            details={
                "statut": row["statut"],
                "reversed_entries": reversed_count,
            },
        )
        conn.commit()

        msg = "Facture supprimee"
        if reversed_count > 0:
            msg = (
                f"Facture supprimee — {reversed_count} ecriture(s) contre-passee(s) "
                "automatiquement (audit trail conserve)"
            )
        return {
            "message": msg,
            "id": invoice_id,
            "reversed_entries": reversed_count,
        }
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("delete_invoice error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        _end_tx(conn, tx_modified)
        conn.close()


@router.delete("/invoices/{invoice_id}/lines/{line_id}")
async def delete_invoice_line(
    invoice_id: int,
    line_id: int,
    user: ErpUser = Depends(get_current_user),
):
    """Delete an invoice line and recalculate totals (BROUILLON only)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Refuse si facture pas BROUILLON (integrite comptable, lecon QA r3)
        _assert_invoice_editable(cursor, invoice_id)
        _ensure_facture_lignes_table(cursor)
        cursor.execute(
            "DELETE FROM facture_lignes WHERE id = %s AND facture_id = %s",
            (line_id, invoice_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Ligne non trouvée")
        _recalculate_invoice(cursor, invoice_id)
        # Commit explicite (no-op en pool autocommit, persist en fallback).
        # Pas de try-swallow: si commit echoue, on rollback + 500 plutot
        # qu'un faux 200 sur une suppression non persistee.
        conn.commit()
        return {"message": "Ligne supprimée"}
    except HTTPException:
        raise
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("delete_invoice_line error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/invoices/{invoice_id}/payment")
async def record_invoice_payment(
    invoice_id: int,
    body: InvoicePayment,
    user: ErpUser = Depends(get_current_user),
):
    """Record a payment on an invoice and update status. Auto-creates accounting entry."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        # Mode transactionnel: l'UPDATE facture + INSERT journal_entry + INSERT
        # journal_lines doit etre atomique. Sans cela (autocommit), un crash
        # entre l'UPDATE et l'INSERT laisse une facture PAYEE sans ecriture =
        # bilan fausse. SELECT FOR UPDATE serialise aussi les paiements
        # concurrents sur la meme facture.
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # BUG #37 fix: refuser un encaissement dans une periode cloturee.
        # On utilise la date de paiement explicite si fournie, sinon today().
        _assert_period_open(
            cursor, body.date_paiement or str(date.today()), strict=True
        )
        # S'assurer que les colonnes type_document/facture_origine_id existent
        # avant la query AVOIR (idempotent).
        _ensure_facture_compliance_columns(cursor)
        # Get current invoice avec lock (anti-race sur paiements concurrents)
        cursor.execute(
            "SELECT id, numero_facture, montant_total, montant_ttc, montant_paye, solde_du, statut, "
            "project_id, client_nom "
            "FROM factures WHERE id = %s FOR UPDATE",
            (invoice_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Facture non trouvée")
        inv = dict(row)
        montant_total = float(inv["montant_total"]) if inv["montant_total"] else (float(inv.get("montant_ttc") or 0))
        montant_paye = float(inv["montant_paye"]) if inv["montant_paye"] else 0.0

        # CORRECTION COMPTABLE: les AVOIR (notes de credit) actifs lies a cette
        # facture reduisent le montant DU par le client. Sans cette soustraction,
        # le solde reste a `montant_total - paye` meme apres un avoir, et la
        # facture ne basculera jamais a PAYEE. Conformite art. 350 LTVQ:
        # l'avoir est une reduction de creance officielle.
        cursor.execute(
            "SELECT COALESCE(SUM(montant_ttc), 0) AS total_avoirs "
            "FROM factures WHERE facture_origine_id = %s "
            "AND type_document = 'AVOIR' "
            "AND statut NOT IN ('ANNULEE', 'BROUILLON')",
            (invoice_id,),
        )
        total_avoirs_actifs = float(cursor.fetchone()["total_avoirs"] or 0)
        montant_du_net = round(montant_total - total_avoirs_actifs, 2)

        new_paye = round(montant_paye + body.montant, 2)
        new_solde = round(montant_du_net - new_paye, 2)
        # Determine new status
        if new_solde <= 0.01:
            new_statut = "PAYEE"
            new_solde = 0.0
        elif new_paye > 0:
            new_statut = "PARTIELLEMENT_PAYEE"
        else:
            new_statut = str(inv["statut"])
        cursor.execute(
            "UPDATE factures SET montant_paye = %s, solde_du = %s, statut = %s, "
            "date_paiement = COALESCE(%s, CURRENT_DATE), mode_paiement = %s, reference_paiement = %s, "
            "updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (new_paye, new_solde, new_statut, body.date_paiement, body.mode_paiement, body.reference, invoice_id),
        )

        # Auto-create accounting entry: ENCAISSEMENT (debit Banque, credit Comptes clients)
        journal_entry_id = None
        try:
            client_nom = inv.get("client_nom") or "Client"
            numero_facture = inv.get("numero_facture") or str(invoice_id)
            projet_id = inv.get("project_id")

            # Look up account IDs (avec auto-seed si manquant)
            compte_1010_id = None
            compte_1100_id = None
            cursor.execute("SELECT id FROM plan_comptable WHERE code = '1010' AND actif = TRUE")
            r = cursor.fetchone()
            if r:
                compte_1010_id = r["id"]
            cursor.execute("SELECT id FROM plan_comptable WHERE code = '1100' AND actif = TRUE")
            r = cursor.fetchone()
            if r:
                compte_1100_id = r["id"]

            # Si comptes manquants, tenter le seed initial avant d'echouer
            if not compte_1010_id or not compte_1100_id:
                try:
                    _ensure_plan_comptable_seeded(cursor)
                except Exception as exc:
                    logger.warning("auto-seed plan_comptable echoue (paiement): %s", exc)
                cursor.execute("SELECT id FROM plan_comptable WHERE code = '1010' AND actif = TRUE")
                r = cursor.fetchone()
                if r:
                    compte_1010_id = r["id"]
                cursor.execute("SELECT id FROM plan_comptable WHERE code = '1100' AND actif = TRUE")
                r = cursor.fetchone()
                if r:
                    compte_1100_id = r["id"]

            # Coherence avec _create_invoice_journal_entry: refus explicite si
            # comptes essentiels absents (au lieu de creer une ecriture avec
            # compte_id NULL, qui fausserait le bilan).
            if not compte_1010_id or not compte_1100_id:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Plan comptable incomplet: comptes 1010 (Encaisse) et/ou "
                        "1100 (Comptes clients) manquants. Verifiez la page "
                        "Plan comptable ou contactez le support."
                    ),
                )

            # TEMP-then-UPDATE pattern for race-safe numero
            cursor.execute(
                "INSERT INTO journal_entries (numero_ecriture, date_ecriture, libelle, type_journal, "
                "reference_externe, source_type, source_id, montant_total, "
                "statut, validated_by, validated_at, created_by, created_at) "
                "VALUES ('TEMP', COALESCE(%s, CURRENT_DATE)::date, %s, 'ENCAISSEMENT', %s, 'paiement_facture', %s, %s, "
                "'VALIDEE', %s, CURRENT_TIMESTAMP, %s, CURRENT_TIMESTAMP) RETURNING id",
                (body.date_paiement,
                 f"Encaissement {numero_facture} - {client_nom}",
                 numero_facture,
                 invoice_id,
                 body.montant,
                 str(user.user_id),
                 str(user.user_id)),
            )
            journal_entry_id = cursor.fetchone()["id"]
            numero_ecriture = f"JE-ENC-{journal_entry_id:05d}"
            cursor.execute(
                "UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s",
                (numero_ecriture, journal_entry_id),
            )

            # Line 1: Debit Encaisse générale (1010)
            cursor.execute(
                "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, libelle, "
                "debit, credit, projet_id, sequence, created_at) "
                "VALUES (%s, %s, '1010', %s, %s, 0, %s, 1, CURRENT_TIMESTAMP)",
                (journal_entry_id, compte_1010_id, f"Encaissement {numero_facture}", body.montant, projet_id),
            )
            # Line 2: Credit Comptes clients (1100)
            cursor.execute(
                "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, libelle, "
                "debit, credit, projet_id, sequence, created_at) "
                "VALUES (%s, %s, '1100', %s, 0, %s, %s, 2, CURRENT_TIMESTAMP)",
                (journal_entry_id, compte_1100_id, f"Encaissement {numero_facture}", body.montant, projet_id),
            )
        except HTTPException:
            # Plan comptable incomplet (400) ou autre HTTPException explicite:
            # remonter intact pour que le client recoive le message clair.
            # NE PAS transformer en 500 generique.
            raise
        except Exception as je_err:
            # En mode transactionnel, un echec ici doit rollback l'UPDATE
            # facture (bilan coherent). On re-raise pour que le except global
            # rollback proprement plutot que swallow + faux 200.
            logger.error("Echec ecriture comptable encaissement facture %s: %s",
                         invoice_id, je_err)
            raise HTTPException(
                status_code=500,
                detail=(
                    "Echec de l'ecriture comptable de l'encaissement. "
                    "Le paiement n'a pas ete enregistre."
                ),
            )

        try:
            conn.commit()
        except Exception as exc:
            logger.warning("record_invoice_payment commit warning: %s", exc)

        return {
            "id": invoice_id,
            "montant_paye": new_paye,
            "solde_du": new_solde,
            "statut": new_statut,
            "journal_entry_id": journal_entry_id,
            "message": "Paiement enregistre",
        }
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("record_invoice_payment error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        _end_tx(conn, tx_modified)
        conn.close()


# ============================================
# TRANSACTIONS (Revenues + Expenses)
# ============================================

@router.get("/transactions")
async def list_transactions(
    user: ErpUser = Depends(get_current_user),
    type_filter: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List financial transactions (invoices as revenues, purchases as expenses)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        items = []

        # Revenues from factures
        if not type_filter or type_filter == "revenus":
            cursor.execute(
                "SELECT id, numero_facture as reference, date_facture as date_transaction, "
                "client_nom as description, COALESCE(NULLIF(montant_total, 0), montant_ttc, 0) as montant, statut, "
                "'revenus' as type_transaction "
                "FROM factures WHERE statut != 'ANNULEE' "
                "ORDER BY date_facture DESC"
            )
            for row in cursor.fetchall():
                d = dict(row)
                if d.get("date_transaction"):
                    d["date_transaction"] = str(d["date_transaction"])
                if d.get("montant") is not None:
                    d["montant"] = float(d["montant"])
                items.append(d)

        # Expenses from bons_commande or depenses
        if not type_filter or type_filter == "depenses":
            try:
                cursor.execute(
                    "SELECT id, numero as reference, date_commande as date_transaction, "
                    "fournisseur_nom as description, COALESCE(NULLIF(montant_total, 0), total, 0) as montant, statut, "
                    "'depenses' as type_transaction "
                    "FROM bons_commande WHERE LOWER(statut) NOT IN ('annule', 'annulee') "
                    "ORDER BY date_commande DESC"
                )
                for row in cursor.fetchall():
                    d = dict(row)
                    if d.get("date_transaction"):
                        d["date_transaction"] = str(d["date_transaction"])
                    if d.get("montant") is not None:
                        d["montant"] = float(d["montant"])
                    items.append(d)
            except Exception:
                pass  # Table may not exist

        # Sort combined list by date descending
        items.sort(key=lambda x: x.get("date_transaction", "") or "", reverse=True)
        total = len(items)
        offset = (page - 1) * per_page
        paginated = items[offset:offset + per_page]
        return {"items": paginated, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_transactions error: %s", exc)
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
# FINANCIAL DASHBOARD
# ============================================

@router.get("/dashboard")
async def get_financial_dashboard(user: ErpUser = Depends(get_current_user)):
    """Get financial dashboard data with monthly breakdowns."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Monthly revenue from factures
        cursor.execute(
            "SELECT date_trunc('month', date_facture) as mois, "
            "COALESCE(SUM(COALESCE(NULLIF(montant_total, 0), montant_ttc, 0)), 0) as revenus "
            "FROM factures WHERE statut != 'ANNULEE' "
            "GROUP BY date_trunc('month', date_facture) "
            "ORDER BY mois"
        )
        monthly_revenus = {}
        for row in cursor.fetchall():
            mois_key = str(row["mois"])[:7] if row["mois"] else "inconnu"
            monthly_revenus[mois_key] = float(row["revenus"])

        # Monthly expenses from journal_entries (debit entries for expense accounts class 5,6)
        monthly_depenses = {}
        try:
            cursor.execute(
                "SELECT date_trunc('month', je.date_ecriture) as mois, "
                "COALESCE(SUM(jl.debit), 0) as depenses "
                "FROM journal_lines jl "
                "JOIN journal_entries je ON je.id = jl.journal_entry_id "
                "JOIN plan_comptable pc ON pc.code = jl.compte_code "
                "WHERE je.statut = 'VALIDEE' AND pc.classe IN (5, 6) "
                "GROUP BY date_trunc('month', je.date_ecriture) "
                "ORDER BY mois"
            )
            for row in cursor.fetchall():
                mois_key = str(row["mois"])[:7] if row["mois"] else "inconnu"
                monthly_depenses[mois_key] = float(row["depenses"])
        except Exception:
            pass

        # Combine into monthly data
        all_months = sorted(set(list(monthly_revenus.keys()) + list(monthly_depenses.keys())))
        monthly_data = []
        total_ca = 0.0
        total_dep = 0.0
        for m in all_months:
            rev = monthly_revenus.get(m, 0.0)
            dep = monthly_depenses.get(m, 0.0)
            total_ca += rev
            total_dep += dep
            monthly_data.append({
                "mois": m,
                "revenus": round(rev, 2),
                "depenses": round(dep, 2),
                "profit": round(rev - dep, 2),
            })

        return {
            "monthly_data": monthly_data,
            "totals": {
                "ca": round(total_ca, 2),
                "depenses": round(total_dep, 2),
                "profit": round(total_ca - total_dep, 2),
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_financial_dashboard error: %s", exc)
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
# PERIODES COMPTABLES (Accounting Periods)
# ============================================

def _ensure_periodes_table(cursor):
    """Create periodes_comptables table if it doesn't exist."""
    try:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS periodes_comptables (
                id SERIAL PRIMARY KEY,
                annee_fiscale INTEGER,
                periode INTEGER,
                date_debut DATE NOT NULL,
                date_fin DATE NOT NULL,
                statut VARCHAR(20) DEFAULT 'OUVERTE',
                cloture_par VARCHAR(100),
                cloture_at TIMESTAMP
            )
        """)
    except Exception as exc:
        logger.warning("_ensure periodes_comptables: %s", exc)
        pass
    try:
        cursor.execute("ALTER TABLE periodes_comptables ADD COLUMN IF NOT EXISTS nom VARCHAR(200)")
    except Exception:
        pass


@router.get("/periods")
async def list_accounting_periods(user: ErpUser = Depends(get_current_user)):
    """List accounting periods."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_periodes_table(cursor)
        cursor.execute(
            "SELECT id, nom, annee_fiscale, periode, date_debut, date_fin, statut, cloture_par, "
            "cloture_at "
            "FROM periodes_comptables ORDER BY date_debut DESC"
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_debut", "date_fin", "cloture_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_accounting_periods error: %s", exc)
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
async def create_accounting_period(body: PeriodCreate, user: ErpUser = Depends(get_current_user)):
    """Create an accounting period."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_periodes_table(cursor)
        cursor.execute(
            "INSERT INTO periodes_comptables (nom, annee_fiscale, periode, date_debut, date_fin, statut) "
            "VALUES (%s, %s, %s, %s, %s, 'OUVERTE') RETURNING id",
            (body.nom or f"P{body.periode} - {body.annee_fiscale}", body.annee_fiscale, body.periode, body.date_debut, body.date_fin),
        )
        row = cursor.fetchone()
        try:
            conn.commit()
        except Exception as exc:
            logger.warning("create_accounting_period commit warning: %s", exc)
        return {"id": row["id"], "annee_fiscale": body.annee_fiscale, "periode": body.periode, "message": "Période créée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_accounting_period error: %s", exc)
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
async def close_accounting_period(period_id: int, user: ErpUser = Depends(get_current_user)):
    """Close an accounting period."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_periodes_table(cursor)
        cursor.execute(
            "UPDATE periodes_comptables SET statut = 'CLOTUREE', "
            "cloture_par = %s, cloture_at = CURRENT_TIMESTAMP "
            "WHERE id = %s AND statut = 'OUVERTE'",
            (str(user.user_id), period_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=400, detail="Période déjà clôturée ou introuvable")
        try:
            conn.commit()
        except Exception as exc:
            logger.warning("close_accounting_period commit warning: %s", exc)
        return {"id": period_id, "statut": "CLOTUREE", "message": "Periode cloturee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("close_accounting_period error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================================
# EXPORT COMPTABLE (CSV + HTML)
# ============================================================

def _csv_response(output: io.StringIO, filename: str):
    """Return a StreamingResponse for CSV download with UTF-8 BOM for Excel."""
    output.seek(0)
    content = "\ufeff" + output.getvalue()
    return StreamingResponse(
        iter([content]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/export/journal/csv")
async def export_journal_csv(
    user: ErpUser = Depends(get_current_user),
    date_debut: Optional[str] = None,
    date_fin: Optional[str] = None,
):
    """Export journal entries to CSV."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres = ["je.statut = 'VALIDEE'"]
        params = []
        if date_debut:
            wheres.append("je.date_ecriture >= %s")
            params.append(date_debut)
        if date_fin:
            wheres.append("je.date_ecriture <= %s")
            params.append(date_fin)
        w = " AND ".join(wheres)
        cursor.execute(
            f"SELECT je.numero_ecriture, je.date_ecriture, je.libelle, je.type_journal, "
            f"jl.compte_code, jl.libelle as ligne_libelle, jl.debit, jl.credit "
            f"FROM journal_lines jl "
            f"JOIN journal_entries je ON je.id = jl.journal_entry_id "
            f"WHERE {w} ORDER BY je.date_ecriture, je.id, jl.sequence",
            params,
        )
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Numero", "Date", "Libelle", "Type", "Compte", "Description", "Debit", "Credit"])
        for row in cursor.fetchall():
            writer.writerow([
                row["numero_ecriture"], str(row["date_ecriture"]),
                row["libelle"], row["type_journal"], row["compte_code"],
                row["ligne_libelle"], float(row["debit"] or 0), float(row["credit"] or 0),
            ])
        return _csv_response(output, "journal_comptable.csv")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("export_journal_csv error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur export")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/export/trial-balance/csv")
async def export_trial_balance_csv(
    user: ErpUser = Depends(get_current_user),
    date_fin: Optional[str] = None,
):
    """Export trial balance to CSV."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        date_filter = ""
        params = []
        if date_fin:
            date_filter = "AND je.date_ecriture <= %s"
            params.append(date_fin)
        cursor.execute(
            f"SELECT pc.code, pc.nom, pc.type, pc.solde_normal, "
            f"COALESCE(SUM(jl.debit), 0) as total_debit, "
            f"COALESCE(SUM(jl.credit), 0) as total_credit "
            f"FROM plan_comptable pc "
            f"LEFT JOIN (journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id "
            f"AND je.statut = 'VALIDEE' {date_filter}) ON jl.compte_code = pc.code "
            f"WHERE pc.actif = TRUE "
            f"GROUP BY pc.code, pc.nom, pc.type, pc.solde_normal "
            f"HAVING COALESCE(SUM(jl.debit), 0) != 0 OR COALESCE(SUM(jl.credit), 0) != 0 "
            f"ORDER BY pc.code",
            params,
        )
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Code", "Nom", "Type", "Solde Normal", "Debit", "Credit", "Solde"])
        for row in cursor.fetchall():
            td, tc = float(row["total_debit"]), float(row["total_credit"])
            sn = (row.get("solde_normal") or "").upper()
            solde = round(td - tc, 2) if sn in ("D", "DEBIT") else round(tc - td, 2)
            writer.writerow([row["code"], row["nom"], row["type"], row["solde_normal"], td, tc, solde])
        return _csv_response(output, "balance_verification.csv")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("export_trial_balance_csv error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur export")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/export/chart-of-accounts/csv")
async def export_chart_of_accounts_csv(user: ErpUser = Depends(get_current_user)):
    """Export chart of accounts to CSV."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT code, nom, type, classe, solde_normal FROM plan_comptable "
            "WHERE actif = TRUE ORDER BY code"
        )
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Code", "Nom", "Type", "Classe", "Solde Normal"])
        for row in cursor.fetchall():
            writer.writerow([row["code"], row["nom"], row["type"], row["classe"], row["solde_normal"]])
        return _csv_response(output, "plan_comptable.csv")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("export_chart_csv error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur export")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/export/ledger/csv")
async def export_ledger_csv(
    user: ErpUser = Depends(get_current_user),
    compte_code: str = Query(...),
    date_debut: Optional[str] = None,
    date_fin: Optional[str] = None,
):
    """Export general ledger for a specific account to CSV."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres = ["jl.compte_code = %s", "je.statut = 'VALIDEE'"]
        params = [compte_code]
        if date_debut:
            wheres.append("je.date_ecriture >= %s")
            params.append(date_debut)
        if date_fin:
            wheres.append("je.date_ecriture <= %s")
            params.append(date_fin)
        w = " AND ".join(wheres)
        cursor.execute(
            f"SELECT je.numero_ecriture, je.date_ecriture, jl.libelle, jl.debit, jl.credit, "
            f"SUM(jl.debit - jl.credit) OVER (ORDER BY je.date_ecriture, jl.id) as solde "
            f"FROM journal_lines jl "
            f"JOIN journal_entries je ON je.id = jl.journal_entry_id "
            f"WHERE {w} ORDER BY je.date_ecriture, jl.id",
            params,
        )
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Numero", "Date", "Libelle", "Debit", "Credit", "Solde"])
        for row in cursor.fetchall():
            writer.writerow([
                row["numero_ecriture"], str(row["date_ecriture"]),
                row["libelle"], float(row["debit"] or 0), float(row["credit"] or 0),
                float(row["solde"] or 0),
            ])
        return _csv_response(output, f"grand_livre_{compte_code}.csv")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("export_ledger_csv error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur export")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================================
# EXPORT QUICKBOOKS IIF + SAGE 50 CSV
# ============================================================

@router.get("/export/quickbooks/iif")
async def export_quickbooks_iif(
    user: ErpUser = Depends(get_current_user),
    date_debut: Optional[str] = None,
    date_fin: Optional[str] = None,
):
    """Export journal entries in QuickBooks IIF (Intuit Interchange Format)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres = ["je.statut = 'VALIDEE'"]
        params = []
        if date_debut:
            wheres.append("je.date_ecriture >= %s")
            params.append(date_debut)
        if date_fin:
            wheres.append("je.date_ecriture <= %s")
            params.append(date_fin)
        w = " AND ".join(wheres)

        # Get all entries with their lines
        cursor.execute(
            f"SELECT je.id, je.numero_ecriture, je.date_ecriture, je.libelle, je.type_journal, "
            f"je.montant_total "
            f"FROM journal_entries je WHERE {w} ORDER BY je.date_ecriture, je.id",
            params,
        )
        entries = [dict(r) for r in cursor.fetchall()]

        output = io.StringIO()
        # IIF Header
        output.write("!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\n")
        output.write("!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO\n")
        output.write("!ENDTRNS\n")

        for entry in entries:
            cursor.execute(
                "SELECT jl.compte_code, jl.libelle, jl.debit, jl.credit, "
                "pc.nom as compte_nom "
                "FROM journal_lines jl "
                "LEFT JOIN plan_comptable pc ON pc.code = jl.compte_code "
                "WHERE jl.journal_entry_id = %s ORDER BY jl.sequence, jl.id",
                (entry["id"],),
            )
            lines = [dict(r) for r in cursor.fetchall()]
            if not lines:
                continue

            try:
                date_str = datetime.strptime(str(entry["date_ecriture"])[:10], "%Y-%m-%d").strftime("%m/%d/%Y")
            except (ValueError, TypeError):
                date_str = ""
            # Map type_journal to QuickBooks TRNSTYPE
            trnstype_map = {
                "VENTES": "INVOICE", "ENCAISSEMENT": "PAYMENT", "ACHAT": "BILL",
                "SALAIRE": "GENERAL JOURNAL", "RETENUE": "GENERAL JOURNAL",
                "LIBERATION_RETENUE": "GENERAL JOURNAL", "AMORTISSEMENT": "GENERAL JOURNAL",
            }
            trnstype = trnstype_map.get(entry.get("type_journal") or "", "GENERAL JOURNAL")
            docnum = entry.get("numero_ecriture") or ""
            memo = (entry.get("libelle") or "").replace("\t", " ").replace("\n", " ")[:255]

            # First line = TRNS (the header line, uses first debit account)
            first_line = lines[0]
            first_acct = f"{first_line['compte_code']} {first_line.get('compte_nom') or ''}".strip()
            first_amt = float(first_line["debit"] or 0) - float(first_line["credit"] or 0)
            output.write(f"TRNS\t{trnstype}\t{date_str}\t{first_acct}\t\t{first_amt:.2f}\t{docnum}\t{memo}\n")

            # Remaining lines = SPL
            for line in lines[1:]:
                acct = f"{line['compte_code']} {line.get('compte_nom') or ''}".strip()
                amt = float(line["debit"] or 0) - float(line["credit"] or 0)
                line_memo = (line.get("libelle") or "").replace("\t", " ").replace("\n", " ")[:255]
                output.write(f"SPL\t{trnstype}\t{date_str}\t{acct}\t\t{amt:.2f}\t{docnum}\t{line_memo}\n")

            output.write("ENDTRNS\n")

        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=export_quickbooks.iif"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("export_quickbooks_iif error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur export IIF")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/export/sage50/csv")
async def export_sage50_csv(
    user: ErpUser = Depends(get_current_user),
    date_debut: Optional[str] = None,
    date_fin: Optional[str] = None,
):
    """Export journal entries in Sage 50 CSV import format."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres = ["je.statut = 'VALIDEE'"]
        params = []
        if date_debut:
            wheres.append("je.date_ecriture >= %s")
            params.append(date_debut)
        if date_fin:
            wheres.append("je.date_ecriture <= %s")
            params.append(date_fin)
        w = " AND ".join(wheres)

        cursor.execute(
            f"SELECT je.numero_ecriture, je.date_ecriture, je.libelle as entry_libelle, "
            f"je.type_journal, jl.compte_code, pc.nom as compte_nom, "
            f"jl.libelle as line_libelle, jl.debit, jl.credit "
            f"FROM journal_lines jl "
            f"JOIN journal_entries je ON je.id = jl.journal_entry_id "
            f"LEFT JOIN plan_comptable pc ON pc.code = jl.compte_code "
            f"WHERE {w} ORDER BY je.date_ecriture, je.id, jl.sequence, jl.id",
            params,
        )
        output = io.StringIO()
        writer = csv.writer(output)
        # Sage 50 compatible columns
        writer.writerow([
            "No Journal", "Date", "Type", "No Compte", "Nom Compte",
            "Description", "Debit", "Credit", "Reference",
        ])
        for row in cursor.fetchall():
            try:
                d_ecriture = datetime.strptime(str(row["date_ecriture"])[:10], "%Y-%m-%d").strftime("%d/%m/%Y")
            except (ValueError, TypeError):
                d_ecriture = ""
            writer.writerow([
                row["numero_ecriture"],
                d_ecriture,
                row["type_journal"] or "GENERAL",
                row["compte_code"] or "",
                row["compte_nom"] or "",
                row["line_libelle"] or row["entry_libelle"] or "",
                f"{float(row['debit'] or 0):.2f}",
                f"{float(row['credit'] or 0):.2f}",
                row["numero_ecriture"] or "",
            ])
        return _csv_response(output, "export_sage50.csv")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("export_sage50_csv error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur export Sage 50")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================================
# TAX DECLARATION (TPS/TVQ)
# ============================================================

@router.get("/tax-declaration")
async def get_tax_declaration(
    user: ErpUser = Depends(get_current_user),
    date_debut: str = Query(...),
    date_fin: str = Query(...),
):
    """Calculate TPS/TVQ tax declaration for a period."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Get totals by tax account
        cursor.execute(
            "SELECT jl.compte_code, "
            "COALESCE(SUM(jl.debit), 0) as total_debit, "
            "COALESCE(SUM(jl.credit), 0) as total_credit "
            "FROM journal_lines jl "
            "JOIN journal_entries je ON je.id = jl.journal_entry_id "
            "WHERE je.statut = 'VALIDEE' "
            "AND jl.compte_code IN ('1200', '1210', '2200', '2210') "
            "AND je.date_ecriture >= %s AND je.date_ecriture <= %s "
            "GROUP BY jl.compte_code",
            (date_debut, date_fin),
        )
        totals = {}
        for row in cursor.fetchall():
            totals[row["compte_code"]] = {
                "debit": float(row["total_debit"]),
                "credit": float(row["total_credit"]),
            }

        # Conformite Revenu Quebec FPZ-500: la TPS collectee NETTE doit
        # tenir compte des AVOIR (notes de credit) qui debitent 2200 pour
        # contre-passer la TPS facturee. Sans cette soustraction, une facture
        # 50$ TPS + AVOIR 50$ TPS donnerait tps_collectee=50$ au lieu de 0$,
        # surevaluant la declaration TPS et conduisant a un trop-percu paye
        # au gouvernement. Idem pour TPS payee sur achats: les retours
        # fournisseurs (credits sur 1200) reduisent les ITC eligibles.
        tps_collectee = round(
            totals.get("2200", {}).get("credit", 0) - totals.get("2200", {}).get("debit", 0),
            2,
        )
        tps_payee = round(
            totals.get("1200", {}).get("debit", 0) - totals.get("1200", {}).get("credit", 0),
            2,
        )
        tps_net = round(tps_collectee - tps_payee, 2)
        tvq_collectee = round(
            totals.get("2210", {}).get("credit", 0) - totals.get("2210", {}).get("debit", 0),
            2,
        )
        tvq_payee = round(
            totals.get("1210", {}).get("debit", 0) - totals.get("1210", {}).get("credit", 0),
            2,
        )
        tvq_net = round(tvq_collectee - tvq_payee, 2)

        # Monthly breakdown
        cursor.execute(
            "SELECT date_trunc('month', je.date_ecriture) as mois, jl.compte_code, "
            "COALESCE(SUM(jl.debit), 0) as total_debit, "
            "COALESCE(SUM(jl.credit), 0) as total_credit "
            "FROM journal_lines jl "
            "JOIN journal_entries je ON je.id = jl.journal_entry_id "
            "WHERE je.statut = 'VALIDEE' "
            "AND jl.compte_code IN ('1200', '1210', '2200', '2210') "
            "AND je.date_ecriture >= %s AND je.date_ecriture <= %s "
            "GROUP BY date_trunc('month', je.date_ecriture), jl.compte_code "
            "ORDER BY mois",
            (date_debut, date_fin),
        )
        monthly_raw = {}
        for row in cursor.fetchall():
            mois_key = str(row["mois"])[:7] if row["mois"] else "inconnu"
            if mois_key not in monthly_raw:
                monthly_raw[mois_key] = {}
            monthly_raw[mois_key][row["compte_code"]] = {
                "debit": float(row["total_debit"]),
                "credit": float(row["total_credit"]),
            }

        breakdown = []
        for mois in sorted(monthly_raw.keys()):
            m = monthly_raw[mois]
            # Idem totaux: soustraire les debits AVOIR sur 2200/2210
            # et les credits retours sur 1200/1210 pour calcul net mensuel.
            tc = round(m.get("2200", {}).get("credit", 0) - m.get("2200", {}).get("debit", 0), 2)
            tp = round(m.get("1200", {}).get("debit", 0) - m.get("1200", {}).get("credit", 0), 2)
            vc = round(m.get("2210", {}).get("credit", 0) - m.get("2210", {}).get("debit", 0), 2)
            vp = round(m.get("1210", {}).get("debit", 0) - m.get("1210", {}).get("credit", 0), 2)
            breakdown.append({
                "mois": mois,
                "tps_collectee": tc, "tps_payee": tp,
                "tps_net": round(tc - tp, 2),
                "tvq_collectee": vc, "tvq_payee": vp,
                "tvq_net": round(vc - vp, 2),
            })

        return {
            "periode": {"date_debut": date_debut, "date_fin": date_fin},
            "tps": {"collectee": tps_collectee, "payee": tps_payee, "net_du": tps_net},
            "tvq": {"collectee": tvq_collectee, "payee": tvq_payee, "net_du": tvq_net},
            "total_net": round(tps_net + tvq_net, 2),
            "breakdown": breakdown,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_tax_declaration error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/export/tax-declaration/csv")
async def export_tax_declaration_csv(
    user: ErpUser = Depends(get_current_user),
    date_debut: str = Query(...),
    date_fin: str = Query(...),
):
    """Export tax declaration to CSV."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    # Reuse the tax-declaration logic
    data = await get_tax_declaration(user=user, date_debut=date_debut, date_fin=date_fin)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Declaration TPS/TVQ", f"Du {date_debut} au {date_fin}"])
    writer.writerow([])
    writer.writerow(["Taxe", "Collectee", "Payee (intrants)", "Net du"])
    writer.writerow(["TPS (5%)", data["tps"]["collectee"], data["tps"]["payee"], data["tps"]["net_du"]])
    writer.writerow(["TVQ (9.975%)", data["tvq"]["collectee"], data["tvq"]["payee"], data["tvq"]["net_du"]])
    writer.writerow(["TOTAL", "", "", data["total_net"]])
    writer.writerow([])
    writer.writerow(["Mois", "TPS Collectee", "TPS Payee", "TPS Net", "TVQ Collectee", "TVQ Payee", "TVQ Net"])
    for m in data["breakdown"]:
        writer.writerow([m["mois"], m["tps_collectee"], m["tps_payee"], m["tps_net"],
                         m["tvq_collectee"], m["tvq_payee"], m["tvq_net"]])
    return _csv_response(output, f"declaration_taxes_{date_debut}_{date_fin}.csv")


# ============================================================
# FACTURE — HTML Generation
# ============================================================

def _fmt_money(val) -> str:
    try:
        v = float(val or 0)
    except (ValueError, TypeError):
        v = 0.0
    return f"{v:,.2f} $"


FACTURE_CONDITIONS = [
    "Paiement du selon les conditions indiquees ci-dessus.",
    "Des frais d'interet de 2% par mois seront appliques sur tout solde en souffrance.",
    "Les cheques retournes entraineront des frais administratifs de 35,00 $.",
    "En cas de litige, les tribunaux du district du siege social sont competents.",
]

STATUT_COLORS_HTML = {
    "BROUILLON": "#a0aec0", "ENVOYEE": "#3182ce", "PAYEE": "#38a169",
    "PARTIELLEMENT_PAYEE": "#d69e2e", "EN_RETARD": "#e53e3e", "ANNULEE": "#718096",
}


def _generate_facture_html(facture, lignes, client_company, enterprise, theme=None):
    """Generate a professional HTML document for an invoice.

    `theme` is an optional tenant color palette from get_document_theme().
    Falls back to DEFAULT_DOCUMENT_THEME so rendering never breaks.

    Conformite Revenu Quebec: si la facture a un `emetteur_snapshot` JSONB
    (figen a l'envoi), on l'utilise en priorite sur `enterprise` (qui
    refleterait l'etat actuel de la config tenant). Idem pour
    `client_snapshot` vs `client_company`.

    Type de document: 'FACTURE' (defaut), 'AVOIR' (note de credit
    Revenu Quebec art. 350 LTVQ), 'ACOMPTE', 'PROFORMA'. Pour AVOIR, le
    label change et la reference vers la facture origine est affichee.
    """
    from .html_utils import DEFAULT_DOCUMENT_THEME, THEME_KEYS
    _t = dict(DEFAULT_DOCUMENT_THEME)
    if isinstance(theme, dict):
        for k in THEME_KEYS:
            v = theme.get(k)
            if isinstance(v, str) and v.strip():
                _t[k] = v

    # Priorite au snapshot fige (conformite Revenu Quebec post-envoi)
    emetteur_snap = facture.get("emetteur_snapshot")
    if isinstance(emetteur_snap, str):
        try:
            emetteur_snap = json.loads(emetteur_snap)
        except (ValueError, TypeError):
            emetteur_snap = None
    emetteur_src = emetteur_snap if isinstance(emetteur_snap, dict) and emetteur_snap else enterprise

    if emetteur_src:
        ent_name = emetteur_src.get("nom", "") or emetteur_src.get("nom_entreprise", "") or "Entreprise"
        ent_address = emetteur_src.get("adresse", "")
        ent_ville = emetteur_src.get("ville", "")
        ent_province = emetteur_src.get("province", "")
        ent_cp = emetteur_src.get("code_postal", "")
        ent_phone = emetteur_src.get("telephone", "") or emetteur_src.get("telephone_bureau", "")
        ent_email = emetteur_src.get("courriel", "") or emetteur_src.get("email", "")
        ent_rbq = emetteur_src.get("rbq", "") or emetteur_src.get("numero_rbq", "")
        ent_neq = emetteur_src.get("neq", "") or emetteur_src.get("numero_neq", "")
        ent_tps = emetteur_src.get("tps", "") or emetteur_src.get("numero_tps", "")
        ent_tvq = emetteur_src.get("tvq", "") or emetteur_src.get("numero_tvq", "")
    else:
        ent_name = "Entreprise"
        ent_address = ent_ville = ent_province = ent_cp = ""
        ent_phone = ent_email = ent_rbq = ent_neq = ent_tps = ent_tvq = ""

    # Client: snapshot prioritaire sur lien dynamique
    client_snap = facture.get("client_snapshot")
    if isinstance(client_snap, str):
        try:
            client_snap = json.loads(client_snap)
        except (ValueError, TypeError):
            client_snap = None
    client_src = client_snap if isinstance(client_snap, dict) and client_snap else {}

    cli_name = client_src.get("nom") or facture.get("client_nom", "") or (client_company.get("nom", "") if client_company else "Client")
    cli_address = client_src.get("adresse") or facture.get("client_adresse", "") or (client_company.get("adresse", "") if client_company else "")
    cli_ville = client_src.get("ville") or facture.get("client_ville", "") or (client_company.get("ville", "") if client_company else "")
    cli_phone = client_src.get("telephone") or facture.get("client_telephone", "") or (client_company.get("telephone", "") if client_company else "")
    cli_email = client_src.get("courriel") or facture.get("client_email", "") or (client_company.get("email", "") if client_company else "")
    # TPS/TVQ client: priorite snapshot, sinon fallback sur companies (conformite >30$)
    cli_tps = (client_src.get("tps") or "") or (client_company.get("numero_tps", "") or client_company.get("tps", "") if client_company else "")
    cli_tvq = (client_src.get("tvq") or "") or (client_company.get("numero_tvq", "") or client_company.get("tvq", "") if client_company else "")

    # Type de document: adapter le label et la reference origine
    type_doc = (facture.get("type_document") or "FACTURE").upper()
    doc_label_map = {
        "FACTURE": "FACTURE",
        "AVOIR": "NOTE DE CREDIT",
        "ACOMPTE": "ACOMPTE",
        "PROFORMA": "PRO FORMA",
    }
    doc_label = doc_label_map.get(type_doc, "FACTURE")
    facture_origine_id = facture.get("facture_origine_id")
    facture_origine_numero = facture.get("facture_origine_numero") or ""  # snapshot du numero origine
    motif_avoir = facture.get("motif_avoir") or ""

    numero = facture.get("numero_facture", "") or facture.get("numero", "") or ""
    statut = facture.get("statut", "BROUILLON")
    date_facture = str(facture.get("date_facture", "") or facture.get("date_emission", "") or facture.get("created_at", ""))[:10]
    date_echeance = str(facture.get("date_echeance", ""))[:10] if facture.get("date_echeance") else ""
    conditions = facture.get("conditions_paiement", "") or ""

    # Totals - from lines or from record
    lignes_total = sum(float(l.get("montant_ligne", 0) or l.get("montant", 0) or 0) for l in lignes)
    def _fv(k):
        v = facture.get(k)
        try:
            return float(v) if v is not None else 0.0
        except (ValueError, TypeError):
            return 0.0

    if lignes_total > 0:
        montant_ht = lignes_total
        tps = round(montant_ht * 0.05, 2)
        tvq = round(montant_ht * 0.09975, 2)
        montant_ttc = round(montant_ht + tps + tvq, 2)
    else:
        montant_ht = _fv("montant_ht") or _fv("sous_total") or 0.0
        tps = _fv("montant_tps") or _fv("tps") or round(montant_ht * 0.05, 2)
        tvq = _fv("montant_tvq") or _fv("tvq") or round(montant_ht * 0.09975, 2)
        montant_ttc = _fv("montant_ttc") or _fv("montant_total") or round(montant_ht + tps + tvq, 2)

    montant_paye = _fv("montant_paye")
    solde_du = _fv("solde_du") or round(montant_ttc - montant_paye, 2)
    s_color = STATUT_COLORS_HTML.get(statut, "#a0aec0")

    # Lines HTML — IMPORTANT: echapper description (user input direct, risque XSS
    # critique vu que WeasyPrint exécute le HTML et que l'apercu inline peut
    # rendre des `<script>` dans un iframe non-sandbox).
    lines_html = ""
    for idx, l in enumerate(lignes, 1):
        desc = _html.escape(str(l.get("description") or ""), quote=True)
        qte = float(l.get("quantite", 1) or 1)
        prix = float(l.get("prix_unitaire", 0) or 0)
        montant = float(l.get("montant_ligne", 0) or l.get("montant", 0) or 0)
        lines_html += f"""<tr>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;color:#718096">{idx}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">{desc}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">{qte:,.2f}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">{_fmt_money(prix)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600">{_fmt_money(montant)}</td>
</tr>"""

    conditions_html = "".join(f"<li>{c}</li>" for c in FACTURE_CONDITIONS)
    notes_raw = facture.get("notes", "") or ""
    notes = _html.escape(str(notes_raw), quote=True)

    # Echapper toutes les variables user-controlled qui finissent dans le HTML
    # principal (defense XSS systemique). Helper inline pour DRY.
    def _h(v):
        return _html.escape(str(v) if v is not None else "", quote=True)

    # Re-bind les variables string injectees dans le f-string final
    ent_name = _h(ent_name)
    ent_address = _h(ent_address)
    ent_ville = _h(ent_ville)
    ent_province = _h(ent_province)
    ent_cp = _h(ent_cp)
    ent_phone = _h(ent_phone)
    ent_email = _h(ent_email)
    ent_rbq = _h(ent_rbq)
    ent_neq = _h(ent_neq)
    ent_tps = _h(ent_tps)
    ent_tvq = _h(ent_tvq)
    cli_name = _h(cli_name)
    cli_address = _h(cli_address)
    cli_ville = _h(cli_ville)
    cli_phone = _h(cli_phone)
    cli_email = _h(cli_email)
    numero = _h(numero)
    statut = _h(statut)
    date_facture = _h(date_facture)
    date_echeance = _h(date_echeance)
    conditions = _h(conditions)
    doc_label = _h(doc_label)

    # Reference vers la facture origine pour les AVOIR (conformite art. 350 LTVQ)
    # Affiche le NUMERO de la facture origine (pas l'ID interne BD), exigence Revenu QC.
    # Echappement HTML obligatoire pour eviter XSS via motif (user input direct).
    origine_ref_html = ""
    if type_doc == "AVOIR" and (facture_origine_id or facture_origine_numero):
        ref_label = facture_origine_numero or f"#{facture_origine_id}"
        ref_label_safe = _html.escape(str(ref_label), quote=True)
        motif_safe = _html.escape(str(motif_avoir), quote=True) if motif_avoir else ""
        origine_ref_html = (
            f'<p style="margin-top:6px;padding:6px 10px;background:#fef3c7;'
            f'border-left:3px solid #f59e0b;font-size:12px;color:#92400e">'
            f'<strong>Note de credit referencant la facture {ref_label_safe}</strong>'
            f'{f" — Motif: {motif_safe}" if motif_safe else ""}</p>'
        )

    # Numeros TPS/TVQ client si presents (conformite Revenu Quebec >30$)
    # Echappement HTML pour eviter XSS si numero TPS contient caracteres speciaux.
    client_taxes_html = ""
    if cli_tps or cli_tvq:
        parts = []
        if cli_tps: parts.append(f"TPS: {_html.escape(str(cli_tps), quote=True)}")
        if cli_tvq: parts.append(f"TVQ: {_html.escape(str(cli_tvq), quote=True)}")
        client_taxes_html = (
            f'<p style="font-size:10px;color:#94a3b8;margin-top:4px">'
            f'{" | ".join(parts)}</p>'
        )

    # Inverser le signe d'affichage pour les AVOIR (montant negatif = credit)
    sign = -1 if type_doc == "AVOIR" else 1
    montant_ht_disp = sign * montant_ht
    tps_disp = sign * tps
    tvq_disp = sign * tvq
    montant_ttc_disp = sign * montant_ttc
    solde_label = "CREDIT ACCORDE" if type_doc == "AVOIR" else "SOLDE DU"

    # Mentions legales Quebec (footer)
    rbq_label = f"Licence RBQ: {ent_rbq}" if ent_rbq else ""
    legal_mentions = []
    if ent_tps: legal_mentions.append(f"No TPS: {ent_tps}")
    if ent_tvq: legal_mentions.append(f"No TVQ: {ent_tvq}")
    legal_html = " — ".join(legal_mentions) if legal_mentions else ""

    html = f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{doc_label} {numero}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}body{{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:#2d3748;line-height:1.5;background:#fff}}
.page{{max-width:850px;margin:0 auto;padding:40px}}.header{{display:flex;justify-content:space-between;align-items:stretch;margin-bottom:0}}
.header-left{{display:flex;align-items:center;gap:16px;max-width:55%}}.enterprise-name{{font-size:22px;font-weight:800;color:{_t['primary']};margin-bottom:4px}}.enterprise-info{{font-size:11px;color:#64748b;line-height:1.5}}.enterprise-info .ent-nums{{color:#94a3b8;font-size:10px;margin-top:2px}}
.header-right{{background:{_t['primary']};color:{_t['header_text']};padding:20px 28px;border-radius:6px;text-align:center;display:flex;flex-direction:column;justify-content:center;min-width:180px}}.doc-label{{font-size:24px;font-weight:800;letter-spacing:2px;color:{_t['header_text']}}}.doc-numero{{font-size:14px;color:{_t['accent_light']};margin-top:4px;font-weight:600}}
.badge{{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;color:#fff;margin-top:6px}}
.header-separator{{height:4px;background:linear-gradient(90deg,{_t['primary']} 0%,{_t['accent']} 50%,{_t['primary']} 100%);border-radius:2px;margin:20px 0 24px}}
.info-grid{{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px}}.info-box{{background:{_t['info_bg']};border-radius:6px;padding:16px 20px;border-left:4px solid {_t['accent']}}}
.info-box h4{{font-size:11px;text-transform:uppercase;color:{_t['accent']};font-weight:700;letter-spacing:1px;margin-bottom:8px}}.info-box p{{font-size:13px;color:#334155}}.info-box .name{{font-size:15px;font-weight:700;color:{_t['primary']};margin-bottom:4px}}
table{{width:100%;border-collapse:collapse;margin-bottom:20px}}thead th{{background:{_t['primary']};color:{_t['header_text']};padding:10px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;text-align:left}}
thead th:nth-child(1){{text-align:center;width:5%}}thead th:nth-child(3),thead th:nth-child(4),thead th:nth-child(5){{text-align:right}}tbody td{{font-size:13px}}
.summary{{margin-left:auto;width:350px;margin-bottom:30px}}.summary-row{{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}}
.summary-row.sub{{border-top:1px solid #e2e8f0;padding-top:8px;margin-top:4px}}.summary-row.total{{border-top:3px solid {_t['primary']};padding-top:10px;margin-top:8px;font-size:18px;font-weight:800;color:{_t['primary']}}}
.summary-row.paid{{color:#38a169}}.summary-row.balance{{color:#e53e3e;font-weight:700;font-size:16px;border-top:2px solid #e53e3e;padding-top:8px;margin-top:4px}}
.conditions{{margin-bottom:30px}}.conditions h3{{font-size:14px;font-weight:700;color:{_t['primary']};margin-bottom:10px;text-transform:uppercase}}.conditions ul{{font-size:12px;color:#4a5568;padding-left:20px}}.conditions li{{margin-bottom:4px}}
.notes{{background:#fffbeb;border:1px solid #f6e05e;border-radius:8px;padding:16px;margin-bottom:30px}}.notes h4{{font-size:12px;font-weight:700;color:#975a16;margin-bottom:6px;text-transform:uppercase}}.notes p{{font-size:12px;color:#744210}}
.payment-info{{background:#f0fff4;border:1px solid #9ae6b4;border-radius:8px;padding:16px;margin-bottom:30px}}.payment-info h4{{font-size:12px;font-weight:700;color:#276749;margin-bottom:6px;text-transform:uppercase}}.payment-info p{{font-size:12px;color:#2f855a}}
.footer{{margin-top:40px;padding-top:15px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#a0aec0}}
.legal-mentions{{margin-top:8px;font-size:10px;color:#64748b;font-style:italic}}
@media print{{.page{{padding:20px}}body{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}}}
</style></head><body><div class="page">
<div class="header"><div class="header-left"><div><div class="enterprise-name">{ent_name}</div><div class="enterprise-info">
{f'{ent_address}, ' if ent_address else ''}{f'{ent_ville}, {ent_province} {ent_cp}' if ent_ville else ''}<br>{f'{ent_phone}' if ent_phone else ''}{f' | {ent_email}' if ent_email else ''}
<div class="ent-nums">{f'RBQ: {ent_rbq}' if ent_rbq else ''}{f' | NEQ: {ent_neq}' if ent_neq else ''}{f' | TPS: {ent_tps}' if ent_tps else ''}{f' | TVQ: {ent_tvq}' if ent_tvq else ''}</div>
</div></div></div><div class="header-right"><div class="doc-label">{doc_label}</div><div class="doc-numero">{numero}</div>
<div class="badge" style="background:{s_color}">{statut}</div>
</div></div>
<div class="header-separator"></div>
{origine_ref_html}

<div class="info-grid"><div class="info-box"><h4>{'Crediter a' if type_doc == 'AVOIR' else 'Facturer a'}</h4><p class="name">{cli_name}</p>
{f'<p>{cli_address}</p>' if cli_address else ''}{f'<p>{cli_ville}</p>' if cli_ville else ''}{f'<p>Tel: {cli_phone}</p>' if cli_phone else ''}{f'<p>{cli_email}</p>' if cli_email else ''}
{client_taxes_html}
</div><div class="info-box"><h4>Details du document</h4>
<p><strong>Date:</strong> {date_facture}</p>
{f'<p><strong>Echeance:</strong> {date_echeance}</p>' if date_echeance and type_doc != 'AVOIR' else ''}
{f'<p><strong>Conditions:</strong> {conditions}</p>' if conditions and type_doc != 'AVOIR' else ''}
{f'<p><strong>Type:</strong> {doc_label}</p>' if type_doc != 'FACTURE' else ''}
</div></div>

<table><thead><tr><th>#</th><th style="width:45%">Description</th><th style="width:15%;text-align:right">Quantite</th><th style="width:17%;text-align:right">Prix unitaire</th><th style="width:18%;text-align:right">Montant</th></tr></thead>
<tbody>{lines_html}{'<tr><td colspan="5" style="padding:20px;text-align:center;color:#a0aec0;font-style:italic">Aucune ligne</td></tr>' if not lignes else ''}</tbody></table>

<div class="summary">
<div class="summary-row sub"><span>Sous-total HT</span><span style="font-weight:600">{_fmt_money(montant_ht_disp)}</span></div>
<div class="summary-row"><span>TPS (5%)</span><span>{_fmt_money(tps_disp)}</span></div>
<div class="summary-row"><span>TVQ (9,975%)</span><span>{_fmt_money(tvq_disp)}</span></div>
<div class="summary-row total"><span>TOTAL TTC</span><span>{_fmt_money(montant_ttc_disp)}</span></div>
{f'<div class="summary-row paid"><span>Montant paye</span><span>- {_fmt_money(montant_paye)}</span></div>' if montant_paye > 0 and type_doc != 'AVOIR' else ''}
{f'<div class="summary-row balance"><span>{solde_label}</span><span>{_fmt_money(sign * solde_du)}</span></div>' if solde_du > 0 and type_doc != 'AVOIR' else ''}
</div>

{f'<div class="notes"><h4>Notes</h4><p>{notes}</p></div>' if notes else ''}

{'' if type_doc == 'AVOIR' else f'<div class="payment-info"><h4>Informations de paiement</h4><p>Veuillez inclure le numero <strong>{numero}</strong> comme reference lors du paiement.</p>' + (f'<p>Conditions: {conditions}</p>' if conditions else '') + '</div>'}

<div class="conditions"><h3>{'Conditions de la note de credit' if type_doc == 'AVOIR' else 'Conditions de facturation'}</h3><ul>{conditions_html}</ul></div>

<div class="footer">{ent_name} — {doc_label} {numero} — Genere le {datetime.now().strftime('%Y-%m-%d %H:%M')}
{f'<div class="legal-mentions">{legal_html}{" — " + rbq_label if rbq_label and legal_html else rbq_label}</div>' if legal_html or rbq_label else ''}
</div>
</div></body></html>"""
    # Post-hoc swap of the hardcoded gray border to the tenant's theme color
    # (no-op when the tenant keeps the default). Keeps inline-preview coherent
    # with the themed SHARED_CSS used by exports.py. Also inject tbody row
    # alternation so the rendered HTML matches the frontend ThemePreview.
    html = html.replace(
        '</style>',
        f"tbody tr:nth-child(even){{background:{_t['table_row_alt']};}}</style>",
        1,
    )
    html = html.replace('#e2e8f0', _t['border'])
    return html


@router.post("/invoices/{invoice_id}/generate-html")
async def generate_invoice_html(invoice_id: int, user: ErpUser = Depends(get_current_user)):
    """Generate a professional HTML document for an invoice."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM factures WHERE id = %s", (invoice_id,))
        facture = cursor.fetchone()
        if not facture:
            raise HTTPException(status_code=404, detail="Facture non trouvée")
        facture = dict(facture)

        # Fetch lines
        lignes = []
        try:
            cursor.execute("SELECT * FROM facture_lignes WHERE facture_id = %s ORDER BY id", (invoice_id,))
            lignes = [dict(r) for r in cursor.fetchall()]
        except Exception:
            pass  # Table may not exist yet

        # Fetch client company
        client_company = None
        cid = facture.get("client_company_id") or facture.get("company_id")
        if cid:
            try:
                cursor.execute("SELECT * FROM companies WHERE id = %s", (cid,))
                row = cursor.fetchone()
                if row:
                    client_company = dict(row)
            except Exception:
                pass

        # Fetch enterprise config from tenant entreprise_config table
        from .html_utils import get_company_info, get_document_theme
        enterprise = get_company_info(cursor)
        theme = get_document_theme(cursor)

        html = _generate_facture_html(facture, lignes, client_company, enterprise, theme=theme)
        return {"html": html, "invoice_id": invoice_id, "numero": facture.get("numero_facture", "") or facture.get("numero", "")}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("generate_invoice_html error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation HTML")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/invoices/{invoice_id}/pdf")
async def download_invoice_pdf(invoice_id: int, user: ErpUser = Depends(get_current_user)):
    """Telecharge la facture au format PDF (rendu via WeasyPrint).

    Utilise le snapshot emetteur/client si la facture a deja ete envoyee
    (conformite Revenu Quebec). Sinon utilise la config actuelle du tenant.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_facture_compliance_columns(cursor)
        cursor.execute("SELECT * FROM factures WHERE id = %s", (invoice_id,))
        facture = cursor.fetchone()
        if not facture:
            raise HTTPException(status_code=404, detail="Facture non trouvee")
        facture = dict(facture)

        lignes = []
        try:
            cursor.execute("SELECT * FROM facture_lignes WHERE facture_id = %s ORDER BY id", (invoice_id,))
            lignes = [dict(r) for r in cursor.fetchall()]
        except Exception:
            pass

        client_company = None
        cid = facture.get("client_company_id") or facture.get("company_id")
        if cid:
            try:
                cursor.execute("SELECT * FROM companies WHERE id = %s", (cid,))
                row = cursor.fetchone()
                if row:
                    client_company = dict(row)
            except Exception:
                pass

        from .html_utils import get_company_info, get_document_theme
        enterprise = get_company_info(cursor)
        theme = get_document_theme(cursor)

        html_str = _generate_facture_html(facture, lignes, client_company, enterprise, theme=theme)
        pdf_bytes = _generate_invoice_pdf(html_str)

        numero = facture.get("numero_facture", "") or facture.get("numero", "") or f"facture-{invoice_id}"
        type_doc = (facture.get("type_document") or "FACTURE").upper()
        prefix = "avoir" if type_doc == "AVOIR" else "facture"
        # Sanitization filename pour eviter injection Content-Disposition
        import re as _re_filename
        numero_safe = _re_filename.sub(r'[^a-zA-Z0-9\-_]', '_', str(numero))[:64] or f"facture-{invoice_id}"
        filename = f"{prefix}-{numero_safe}.pdf"

        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("download_invoice_pdf error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation PDF")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/invoices/{invoice_id}/send")
async def send_invoice_by_email(
    invoice_id: int,
    body: InvoiceSendRequest,
    user: ErpUser = Depends(get_current_user),
):
    """Envoie la facture par courriel au destinataire avec PDF en piece jointe.

    Workflow:
    1. Verifier statut autorise (BROUILLON ou ENVOYEE)
    2. Fige le snapshot emetteur/client sur la facture (conformite Revenu QC)
    3. Genere HTML puis PDF (WeasyPrint)
    4. Envoie par SMTP via send_internal_email (helper emails.py)
    5. Si BROUILLON -> bascule ENVOYEE + cree ecriture comptable
    6. Update date_envoi, envoye_par, envoye_a
    7. Audit log

    Le PDF est attache au courriel mais PAS stocke en BD (eviter explosion
    BD; le PDF est regenere a la demande via /pdf si besoin).
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_facture_compliance_columns(cursor)

        # SELECT FOR UPDATE: serialise contre clics multiples / envois concurrents
        cursor.execute("SELECT * FROM factures WHERE id = %s FOR UPDATE", (invoice_id,))
        facture_row = cursor.fetchone()
        if not facture_row:
            raise HTTPException(status_code=404, detail="Facture non trouvee")
        facture = dict(facture_row)
        statut = facture.get("statut", "BROUILLON")

        ALLOWED_SEND_STATUTS = {"BROUILLON", "ENVOYEE", "PARTIELLEMENT_PAYEE", "EN_RETARD"}
        if statut not in ALLOWED_SEND_STATUTS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Impossible d'envoyer une facture {statut}. "
                    "Seules les factures BROUILLON, ENVOYEE, PARTIELLEMENT_PAYEE "
                    "et EN_RETARD peuvent etre envoyees."
                ),
            )

        # Charger lignes + client + emetteur
        cursor.execute("SELECT * FROM facture_lignes WHERE facture_id = %s ORDER BY id", (invoice_id,))
        lignes = [dict(r) for r in cursor.fetchall()]

        # Protection DoS: refuser de generer un PDF pour une facture geante
        # (memoire + temps WeasyPrint). 1000 lignes couvre largement les cas
        # de facturation construction realistes.
        if len(lignes) > 1000:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Facture avec {len(lignes)} lignes — generation PDF refusee "
                    "pour eviter la surcharge serveur (max 1000 lignes par facture)."
                ),
            )

        client_company = None
        cid = facture.get("client_company_id") or facture.get("company_id")
        if cid:
            try:
                cursor.execute("SELECT * FROM companies WHERE id = %s", (cid,))
                row = cursor.fetchone()
                if row:
                    client_company = dict(row)
            except Exception:
                pass

        from .html_utils import get_company_info, get_document_theme
        enterprise = get_company_info(cursor)
        theme = get_document_theme(cursor)

        # Verification montant > 0 avant envoi (eviter facture vide envoyee)
        ttc = float(facture.get("montant_ttc") or facture.get("montant_total") or 0)
        if ttc <= 0 and not lignes:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Impossible d'envoyer une facture sans lignes ni montant. "
                    "Ajoutez au moins une ligne avant l'envoi."
                ),
            )

        # Snapshot emetteur + client (figen sur la facture pour conformite)
        emetteur_snap = _build_emetteur_snapshot(enterprise)
        client_snap = _build_client_snapshot(facture, client_company)

        # Mettre a jour snapshot sur la facture AVANT generation HTML.
        # COALESCE: ne FIGE QU'AU 1er envoi. Conformite Revenu Quebec: si
        # facture renvoyee plusieurs fois (ex: rappel client), le snapshot
        # historique du 1er envoi est preserve — sinon la regeneration du
        # PDF apres modification de la config tenant produirait un document
        # different de celui imprime/envoye au client (perte d'audit trail).
        cursor.execute(
            "UPDATE factures SET "
            "emetteur_snapshot = COALESCE(emetteur_snapshot, %s::jsonb), "
            "client_snapshot = COALESCE(client_snapshot, %s::jsonb), "
            "updated_at = CURRENT_TIMESTAMP "
            "WHERE id = %s",
            (json.dumps(emetteur_snap), json.dumps(client_snap), invoice_id),
        )
        # Recharger les snapshots effectifs (pour AVOIR avec snapshot pre-existant
        # de la facture origine, on doit utiliser l'original, pas le nouveau).
        cursor.execute(
            "SELECT emetteur_snapshot, client_snapshot FROM factures WHERE id = %s",
            (invoice_id,),
        )
        snap_row = cursor.fetchone()
        if snap_row:
            facture["emetteur_snapshot"] = snap_row.get("emetteur_snapshot") or emetteur_snap
            facture["client_snapshot"] = snap_row.get("client_snapshot") or client_snap
        else:
            facture["emetteur_snapshot"] = emetteur_snap
            facture["client_snapshot"] = client_snap

        # Generation HTML + PDF
        html_str = _generate_facture_html(facture, lignes, client_company, enterprise, theme=theme)
        pdf_bytes = _generate_invoice_pdf(html_str)

        # Charger template courriel (facture_envoyee) ou utiliser override
        numero = facture.get("numero_facture", "") or facture.get("numero", "") or str(invoice_id)
        type_doc = (facture.get("type_document") or "FACTURE").upper()
        doc_label = "Note de credit" if type_doc == "AVOIR" else "Facture"
        ent_name = emetteur_snap.get("nom") or "Entreprise"

        subject = body.subject_override or f"{doc_label} #{numero} - {ent_name}"

        # Helper XSS protection pour le body_html du courriel:
        # un client mail peut rendre <a href="javascript:..."> ou des liens
        # de phishing si on injecte un nom utilisateur non-echappe. Toutes
        # les variables user-controlled DOIVENT etre echappees avant
        # interpolation dans le HTML envoye par email.
        def _esc(v):
            return _html.escape(str(v) if v is not None else "", quote=True)

        # Corps HTML simple si pas d'override
        if body.message_override:
            # L'override est traite comme du texte brut (les \n deviennent <br>)
            override_safe = _esc(body.message_override).replace("\n", "<br>")
            body_html = f"<p>{override_safe}</p>"
            body_text = body.message_override
        else:
            client_nom_raw = client_snap.get("nom") or "Madame/Monsieur"
            date_echeance_raw = str(facture.get("date_echeance", ""))[:10] if facture.get("date_echeance") else "Non specifiee"
            modalites_raw = facture.get("conditions_paiement") or "Net 30"
            ent_name_raw = emetteur_snap.get("nom") or "Entreprise"
            numero_raw = facture.get("numero_facture", "") or facture.get("numero", "") or str(invoice_id)
            doc_label_raw = "Note de credit" if type_doc == "AVOIR" else "Facture"
            montant_ttc_disp = float(facture.get("montant_ttc") or facture.get("montant_total") or 0)
            body_html = (
                f"<p>Bonjour {_esc(client_nom_raw)},</p>"
                f"<p>Veuillez trouver ci-joint la {_esc(doc_label_raw.lower())} <strong>#{_esc(numero_raw)}</strong>.</p>"
                f"<p>Montant total: <strong>{_esc(_fmt_money(montant_ttc_disp))}</strong><br>"
                f"Date d'echeance: {_esc(date_echeance_raw)}<br>"
                f"Modalites de paiement: {_esc(modalites_raw)}</p>"
                f"<p>Merci pour votre confiance.</p>"
                f"<p>Cordialement,<br>{_esc(ent_name_raw)}</p>"
            )
            body_text = (
                f"Bonjour {client_nom_raw},\n\n"
                f"Veuillez trouver ci-joint la {doc_label_raw.lower()} #{numero_raw}.\n"
                f"Montant total: {_fmt_money(montant_ttc_disp)}\n"
                f"Date d'echeance: {date_echeance_raw}\n"
                f"Modalites: {modalites_raw}\n\n"
                f"Cordialement,\n{ent_name_raw}"
            )

        # Verifier la taille du PDF generes (Gmail/Outlook plafonnent ~25MB).
        # 20MB laisse une marge confortable pour l'envelope SMTP.
        if len(pdf_bytes) > 20 * 1024 * 1024:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"PDF genere trop volumineux ({len(pdf_bytes) // 1024 // 1024} MB). "
                    "Reduisez le nombre de lignes ou contactez le support."
                ),
            )

        # Envoi via helper SMTP avec PDF en piece jointe
        from .emails import send_internal_email_with_attachment
        from_address = emetteur_snap.get("courriel") or ""
        # Sanitization filename: enlever caracteres de controle / quotes / slashes
        # qui pourraient casser le header Content-Disposition ou ouvrir une
        # injection via numero_facture user-controlled.
        import re as _re_filename
        numero_safe = _re_filename.sub(r'[^a-zA-Z0-9\-_]', '_', str(numero))[:64] or f"facture-{invoice_id}"
        attachment_filename = f"{'avoir' if type_doc == 'AVOIR' else 'facture'}-{numero_safe}.pdf"

        sent_ok, send_err = send_internal_email_with_attachment(
            from_name=ent_name,
            from_address=from_address,
            to_email=body.to_email,
            subject=subject,
            body_html=body_html,
            body_text=body_text,
            cc=body.cc,
            bcc=body.bcc,
            attachments=[(attachment_filename, "application/pdf", pdf_bytes)],
        )

        if not sent_ok:
            # Rollback (snapshot pas figen si envoi echoue)
            conn.rollback()
            raise HTTPException(
                status_code=502,
                detail=f"Echec d'envoi du courriel: {send_err or 'erreur inconnue'}",
            )

        # Mettre a jour facture: date_envoi, envoye_par, envoye_a, statut
        now_str = datetime.now().isoformat()
        new_statut = statut
        journal_entry_id = None
        if statut == "BROUILLON":
            new_statut = "ENVOYEE"
            try:
                _ensure_sync_columns(cursor)
                journal_entry_id = _create_invoice_journal_entry(
                    cursor, invoice_id, strict_period=True
                )
            except HTTPException:
                raise
            except Exception as exc:
                logger.error("Echec ecriture facture %s post-envoi: %s", invoice_id, exc)
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Courriel envoye mais ecriture comptable echouee. "
                        "Veuillez contacter le support."
                    ),
                )

        cursor.execute(
            "UPDATE factures SET date_envoi = COALESCE(date_envoi, %s::timestamp), "
            "envoye_par = %s, envoye_a = %s, statut = %s, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = %s",
            (now_str, getattr(user, "email", None) or str(getattr(user, "user_id", "")),
             body.to_email, new_statut, invoice_id),
        )

        _log_accounting_action(
            cursor, user, "send", "invoice", invoice_id,
            details={
                "to_email": body.to_email,
                "cc": body.cc,
                "bcc": body.bcc,
                "previous_statut": statut,
                "new_statut": new_statut,
                "journal_entry_id": journal_entry_id,
                "pdf_size_bytes": len(pdf_bytes),
            },
        )

        conn.commit()

        result = {
            "message": "Courriel envoye avec succes",
            "invoice_id": invoice_id,
            "to_email": body.to_email,
            "statut": new_statut,
            "pdf_size_bytes": len(pdf_bytes),
        }
        if journal_entry_id:
            result["journal_entry_id"] = journal_entry_id
        return result

    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("send_invoice_by_email error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de l'envoi de la facture")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        _end_tx(conn, tx_modified)
        conn.close()


@router.post("/invoices/{invoice_id}/credit-note")
async def create_credit_note(
    invoice_id: int,
    body: CreditNoteCreate,
    user: ErpUser = Depends(get_current_user),
):
    """Cree une note de credit (AVOIR) referencant une facture origine.

    Conformite Revenu Quebec art. 350 LTVQ: pour rembourser des taxes
    deja perceptees, il FAUT emettre une note de credit explicite
    (pas une facture negative). La note de credit DOIT referer la
    facture origine.

    Workflow:
    1. Verifier facture origine existe + statut envoyee/payee
    2. Generer numero AV-YYYY-NNNNN
    3. Creer nouvelle facture type_document='AVOIR', facture_origine_id=N
    4. Si montant_total fourni: AVOIR partiel (montant exact)
    5. Sinon: AVOIR total (clone des montants de la facture origine)
    6. Statut initial: BROUILLON (pour permettre review avant envoi)
    7. Copier client_snapshot de l'origine si present
    8. Pas d'ecriture comptable a la creation (BROUILLON);
       generee lors du passage ENVOYEE comme une facture normale,
       mais avec montants negatifs (contre-passation comptable).
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_facture_compliance_columns(cursor)
        _ensure_facture_lignes_table(cursor)

        cursor.execute("SELECT * FROM factures WHERE id = %s FOR UPDATE", (invoice_id,))
        origine = cursor.fetchone()
        if not origine:
            raise HTTPException(status_code=404, detail="Facture origine non trouvee")
        origine = dict(origine)
        type_origine = (origine.get("type_document") or "FACTURE").upper()
        if type_origine != "FACTURE":
            raise HTTPException(
                status_code=400,
                detail=f"Impossible de creer un avoir pour un document de type {type_origine}",
            )
        statut_origine = origine.get("statut", "BROUILLON")
        if statut_origine in ("BROUILLON", "ANNULEE"):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Impossible de creer un avoir pour une facture {statut_origine}. "
                    "La facture doit avoir ete envoyee et ne pas etre annulee."
                ),
            )

        # Determiner montants de l'avoir
        origine_ttc = float(origine.get("montant_ttc") or origine.get("montant_total") or 0)
        if origine_ttc <= 0:
            raise HTTPException(
                status_code=400,
                detail="Facture origine sans montant — impossible de creer un avoir.",
            )

        # Verifier le cumul des avoirs existants pour ne pas depasser le TTC origine
        # (evite de creer plusieurs avoirs partiels qui cumulativement excederaient
        # le montant de la facture, ce qui serait incoherent comptablement).
        cursor.execute(
            "SELECT COALESCE(SUM(montant_ttc), 0) AS cumul "
            "FROM factures WHERE facture_origine_id = %s "
            "AND type_document = 'AVOIR' "
            "AND statut NOT IN ('ANNULEE')",
            (invoice_id,),
        )
        cumul_avoirs_existants = float(cursor.fetchone()["cumul"] or 0)
        montant_demande = body.montant_total if body.montant_total is not None else origine_ttc
        if cumul_avoirs_existants + montant_demande > origine_ttc + 0.01:  # tolerance arrondi
            disponible = max(0, origine_ttc - cumul_avoirs_existants)
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Avoirs cumules ({cumul_avoirs_existants:.2f}) + nouvel avoir "
                    f"({montant_demande:.2f}) depasseraient le montant de la facture "
                    f"origine ({origine_ttc:.2f}). Maximum disponible: {disponible:.2f}."
                ),
            )

        if body.montant_total is not None:
            if body.montant_total > origine_ttc:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Le montant de l'avoir ({body.montant_total:.2f}) ne peut "
                        f"depasser celui de la facture origine ({origine_ttc:.2f})."
                    ),
                )
            ttc_avoir = round(body.montant_total, 2)
            ht_avoir = round(ttc_avoir / 1.14975, 2)
            tps_avoir = round(ht_avoir * 0.05, 2)
            tvq_avoir = round(ttc_avoir - ht_avoir - tps_avoir, 2)
        else:
            ttc_avoir = origine_ttc
            ht_avoir = float(origine.get("montant_ht") or round(origine_ttc / 1.14975, 2))
            # IMPORTANT: lire `montant_tps` AVANT `tps` (qui est le TAUX 5.0 — bug
            # historique de nommage). Idem TVQ.
            tps_avoir = float(origine.get("montant_tps") or round(ht_avoir * 0.05, 2))
            tvq_avoir = float(origine.get("montant_tvq") or round(ht_avoir * 0.09975, 2))

        date_avoir = body.date_avoir or str(date.today())

        # Si la facture origine n'a pas de snapshot emetteur/client (cas des
        # factures legacy creees avant cette feature), construire le snapshot
        # depuis la config tenant actuelle pour figer des le BROUILLON.
        # Conformite Revenu Quebec: meme un AVOIR BROUILLON doit pouvoir etre
        # imprime avec les bonnes mentions, et ces mentions ne doivent pas
        # changer entre creation et envoi.
        origine_emetteur_snap = origine.get("emetteur_snapshot")
        origine_client_snap = origine.get("client_snapshot")
        if not origine_emetteur_snap or not origine_client_snap:
            try:
                from .html_utils import get_company_info as _gci
                _ent_now = _gci(cursor)
                if not origine_emetteur_snap:
                    origine_emetteur_snap = _build_emetteur_snapshot(_ent_now)
                if not origine_client_snap:
                    # Charger company origine pour snapshot
                    _cc_origine = None
                    _cid = origine.get("client_company_id")
                    if _cid:
                        cursor.execute("SELECT * FROM companies WHERE id = %s", (_cid,))
                        _ccr = cursor.fetchone()
                        if _ccr:
                            _cc_origine = dict(_ccr)
                    origine_client_snap = _build_client_snapshot(origine, _cc_origine)
            except Exception as exc:
                logger.warning("create_credit_note: build snapshot fallback failed: %s", exc)
                origine_emetteur_snap = origine_emetteur_snap or {}
                origine_client_snap = origine_client_snap or {}

        numero_origine = origine.get("numero_facture") or origine.get("numero") or f"#{invoice_id}"

        # Generer numero AV-YYYY-NNNNN (pattern aligne avec FACT-YYYY-NNNNN)
        # FIX P3 (B7): timezone Toronto pour year prefix
        try:
            from zoneinfo import ZoneInfo
            now = datetime.now(ZoneInfo("America/Toronto"))
        except Exception:
            now = datetime.now()
        year_str = str(now.year)
        cursor.execute(
            "INSERT INTO factures ("
            "  numero_facture, client_company_id, type_destinataire, "
            "  client_nom, project_id, "
            "  date_facture, date_emission, "
            "  conditions_paiement, "
            "  taux_tps, taux_tvq, "
            "  montant_ht, tps, montant_tps, tvq, montant_tvq, "
            "  montant_ttc, montant_total, montant_paye, solde_du, "
            "  statut, notes, notes_internes, "
            "  type_document, facture_origine_id, facture_origine_numero, motif_avoir, "
            "  client_snapshot, emetteur_snapshot, "
            "  created_at"
            ") VALUES ("
            "  %s, %s, 'client', "
            "  %s, %s, "
            "  %s::date, %s::date, "
            "  'Aucune (note de credit)', "
            "  5.0, 9.975, "
            "  %s, %s, %s, %s, %s, "
            "  %s, %s, 0, 0, "
            "  'BROUILLON', %s, %s, "
            "  'AVOIR', %s, %s, %s, "
            "  %s::jsonb, %s::jsonb, "
            "  CURRENT_TIMESTAMP"
            ") RETURNING id",
            (
                'TEMP', origine.get("client_company_id"),
                origine.get("client_nom"), origine.get("project_id"),
                date_avoir, date_avoir,
                ht_avoir, tps_avoir, tps_avoir, tvq_avoir, tvq_avoir,
                ttc_avoir, ttc_avoir,
                f"Note de credit referencant facture {numero_origine}",
                body.notes_internes,
                invoice_id, numero_origine, body.raison,
                json.dumps(origine_client_snap) if origine_client_snap else None,
                json.dumps(origine_emetteur_snap) if origine_emetteur_snap else None,
            ),
        )
        avoir_id = cursor.fetchone()["id"]
        numero_avoir = f"AV-{year_str}-{avoir_id:05d}"
        cursor.execute(
            "UPDATE factures SET numero_facture = %s WHERE id = %s",
            (numero_avoir, avoir_id),
        )

        # Cloner les lignes de la facture origine (avec quantites/montants
        # ajustes au prorata si avoir partiel)
        if body.montant_total is not None and body.montant_total < origine_ttc:
            ratio = body.montant_total / origine_ttc
        else:
            ratio = 1.0

        cursor.execute(
            "SELECT description, quantite, prix_unitaire, montant, sequence_ligne, categorie "
            "FROM facture_lignes WHERE facture_id = %s ORDER BY sequence_ligne, id",
            (invoice_id,),
        )
        origine_lignes = [dict(r) for r in cursor.fetchall()]

        if origine_lignes:
            for ln in origine_lignes:
                ln_montant = round(float(ln.get("montant") or 0) * ratio, 2)
                ln_prix = round(float(ln.get("prix_unitaire") or 0) * ratio, 2)
                cursor.execute(
                    "INSERT INTO facture_lignes (facture_id, description, quantite, "
                    "prix_unitaire, montant, montant_ligne, sequence_ligne, categorie, date_creation) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)",
                    (
                        avoir_id,
                        f"AVOIR — {ln.get('description') or ''}",
                        ln.get("quantite") or 1,
                        ln_prix,
                        ln_montant,
                        ln_montant,
                        ln.get("sequence_ligne") or 1,
                        ln.get("categorie"),
                    ),
                )
        else:
            # Pas de lignes origine — creer une ligne unique recapitulative
            cursor.execute(
                "INSERT INTO facture_lignes (facture_id, description, quantite, "
                "prix_unitaire, montant, montant_ligne, sequence_ligne, date_creation) "
                "VALUES (%s, %s, 1, %s, %s, %s, 1, CURRENT_TIMESTAMP)",
                (
                    avoir_id,
                    f"Note de credit — Facture #{origine.get('numero_facture') or invoice_id}",
                    ht_avoir, ht_avoir, ht_avoir,
                ),
            )

        _log_accounting_action(
            cursor, user, "create", "credit_note", avoir_id,
            details={
                "facture_origine_id": invoice_id,
                "numero_avoir": numero_avoir,
                "montant_ttc": ttc_avoir,
                "raison": body.raison,
                "ratio": ratio,
            },
        )

        conn.commit()
        return {
            "id": avoir_id,
            "numero_facture": numero_avoir,
            "type_document": "AVOIR",
            "facture_origine_id": invoice_id,
            "montant_ttc": ttc_avoir,
            "statut": "BROUILLON",
            "message": (
                "Note de credit creee en BROUILLON. Editez et envoyez via "
                "la pipeline normale pour generer l'ecriture comptable."
            ),
        }
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("create_credit_note error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la note de credit")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        _end_tx(conn, tx_modified)
        conn.close()


# ============================================================
# RECURRENCE — Templates de factures recurrentes
# ============================================================

def _serialize_recurring(row: dict) -> dict:
    """Convertit une row factures_recurrentes en dict JSON-safe."""
    d = dict(row)
    for k in ("date_debut", "date_fin", "prochaine_date"):
        if d.get(k):
            d[k] = str(d[k])
    for k in ("derniere_generation_le", "created_at", "updated_at"):
        if d.get(k):
            d[k] = str(d[k])
    # template_lignes est deja un dict/list (JSONB auto-parse psycopg2)
    if isinstance(d.get("template_lignes"), str):
        try:
            d["template_lignes"] = json.loads(d["template_lignes"])
        except Exception:
            d["template_lignes"] = []
    # Calcul commodites
    d["nb_restantes"] = None
    if d.get("nb_occurrences_max") is not None:
        d["nb_restantes"] = max(0, int(d["nb_occurrences_max"]) - int(d.get("nb_occurrences_generees") or 0))
    return d


@router.post("/recurring-invoices")
async def create_recurring_invoice(
    body: RecurringInvoiceCreate,
    user: ErpUser = Depends(get_current_user),
):
    """Cree un template de facture recurrente.

    Le template ne genere PAS de facture immediatement. La premiere
    facture sera generee lors du prochain passage du cron quotidien
    si `prochaine_date <= today`. Pour generer immediatement, utiliser
    POST /recurring-invoices/{id}/generate-now apres la creation.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    # Validation date_debut
    try:
        date_debut_obj = datetime.strptime(body.date_debut, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="date_debut invalide (YYYY-MM-DD attendu)")

    if body.date_fin:
        try:
            date_fin_obj = datetime.strptime(body.date_fin, "%Y-%m-%d").date()
            if date_fin_obj <= date_debut_obj:
                raise HTTPException(
                    status_code=400,
                    detail="date_fin doit etre posterieure a date_debut",
                )
        except ValueError:
            raise HTTPException(status_code=400, detail="date_fin invalide (YYYY-MM-DD)")

    if body.auto_envoi_email and not body.email_destinataire:
        raise HTTPException(
            status_code=400,
            detail="email_destinataire requis si auto_envoi_email=true",
        )

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_recurring_reminders_tables(cursor)

        # Verifier que le client existe (pas de FK formelle car multi-tenant)
        cursor.execute("SELECT id, nom FROM companies WHERE id = %s", (body.client_company_id,))
        cli = cursor.fetchone()
        if not cli:
            raise HTTPException(status_code=400, detail="Client (companies.id) introuvable")

        # template_lignes en JSONB
        lignes_json = json.dumps([ln.model_dump() for ln in body.lignes])

        # Premiere prochaine_date = date_debut (genere au 1er passage cron)
        cursor.execute(
            "INSERT INTO factures_recurrentes ("
            "  nom, client_company_id, project_id, frequence, interval_count, "
            "  date_debut, date_fin, prochaine_date, nb_occurrences_max, "
            "  statut, statut_facture_genere, auto_envoi_email, email_destinataire, "
            "  conditions_paiement, notes, notes_internes, template_lignes, created_by, "
            "  created_at, updated_at"
            ") VALUES ("
            "  %s, %s, %s, %s, %s, "
            "  %s::date, %s::date, %s::date, %s, "
            "  'ACTIVE', %s, %s, %s, "
            "  %s, %s, %s, %s::jsonb, %s, "
            "  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP"
            ") RETURNING id",
            (
                body.nom, body.client_company_id, body.project_id,
                body.frequence, body.interval_count,
                body.date_debut, body.date_fin, body.date_debut, body.nb_occurrences_max,
                body.statut_facture_genere, body.auto_envoi_email, body.email_destinataire,
                body.conditions_paiement, body.notes, body.notes_internes, lignes_json,
                getattr(user, "email", None) or str(getattr(user, "user_id", "")),
            ),
        )
        rid = cursor.fetchone()["id"]

        _log_accounting_action(
            cursor, user, "create", "recurring_invoice", rid,
            details={
                "nom": body.nom,
                "frequence": body.frequence,
                "interval_count": body.interval_count,
                "date_debut": body.date_debut,
                "nb_lignes": len(body.lignes),
            },
        )
        conn.commit()
        return {
            "id": rid,
            "message": "Template de facture recurrente cree.",
            "prochaine_date": body.date_debut,
        }
    except HTTPException:
        try: conn.rollback()
        except Exception: pass
        raise
    except Exception as exc:
        logger.error("create_recurring_invoice error: %s", exc)
        try: conn.rollback()
        except Exception: pass
        raise HTTPException(status_code=500, detail="Erreur creation template recurrent")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.get("/recurring-invoices")
async def list_recurring_invoices(
    user: ErpUser = Depends(get_current_user),
    statut: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """Liste paginee des templates recurrents."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_recurring_reminders_tables(cursor)
        wheres, params = [], []
        if statut:
            wheres.append("r.statut = %s")
            params.append(statut)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) AS total FROM factures_recurrentes r WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT r.*, c.nom AS client_nom FROM factures_recurrentes r "
            f"LEFT JOIN companies c ON c.id = r.client_company_id "
            f"WHERE {w} ORDER BY r.statut ASC, r.prochaine_date ASC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [_serialize_recurring(r) for r in cursor.fetchall()]
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_recurring_invoices error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.get("/recurring-invoices/{recurring_id}")
async def get_recurring_invoice(recurring_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_recurring_reminders_tables(cursor)
        cursor.execute(
            "SELECT r.*, c.nom AS client_nom FROM factures_recurrentes r "
            "LEFT JOIN companies c ON c.id = r.client_company_id WHERE r.id = %s",
            (recurring_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Template recurrent non trouve")
        return _serialize_recurring(row)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_recurring_invoice error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.put("/recurring-invoices/{recurring_id}")
async def update_recurring_invoice(
    recurring_id: int,
    body: RecurringInvoiceUpdate,
    user: ErpUser = Depends(get_current_user),
):
    """Modifie un template recurrent. Les changements n'affectent que les
    PROCHAINES factures generees, pas celles deja creees."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        # FIX P1 (TX9): mode transactionnel pour que SELECT FOR UPDATE tienne
        # le lock entre statements. Sans _begin_tx, le pool est en autocommit
        # et le lock est libere immediatement -> race condition entre SELECT
        # et UPDATE (un autre user peut toggler le statut entre les deux).
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_recurring_reminders_tables(cursor)
        cursor.execute("SELECT id, statut FROM factures_recurrentes WHERE id = %s FOR UPDATE", (recurring_id,))
        existing = cursor.fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Template recurrent non trouve")
        if existing["statut"] in ("TERMINEE", "ANNULEE"):
            raise HTTPException(
                status_code=400,
                detail=f"Impossible de modifier un template {existing['statut']}",
            )

        updates = body.model_dump(exclude_unset=True, exclude_none=True)
        if "frequence" in updates and updates["frequence"] not in VALID_FREQUENCES:
            raise HTTPException(status_code=400, detail=f"Frequence invalide: {updates['frequence']}")
        if "statut_facture_genere" in updates and updates["statut_facture_genere"] not in ("BROUILLON", "ENVOYEE"):
            raise HTTPException(status_code=400, detail="statut_facture_genere doit etre BROUILLON ou ENVOYEE")

        if "lignes" in updates:
            updates["template_lignes"] = json.dumps([
                ln if isinstance(ln, dict) else ln.model_dump()
                for ln in updates.pop("lignes")
            ])

        if not updates:
            raise HTTPException(status_code=400, detail="Aucun champ a modifier")

        sets, vals = [], []
        for k, v in updates.items():
            if k == "template_lignes":
                sets.append(f"{k} = %s::jsonb")
            elif k in ("date_fin", "prochaine_date"):
                sets.append(f"{k} = %s::date")
            else:
                sets.append(f"{k} = %s")
            vals.append(v)

        # FIX P1 (B-P1-7): si l'utilisateur ajuste prochaine_date manuellement,
        # verifier qu'elle reste >= date_debut du template (etat logique valide).
        if updates.get("prochaine_date"):
            cursor.execute(
                "SELECT date_debut FROM factures_recurrentes WHERE id = %s",
                (recurring_id,),
            )
            _row_dd = cursor.fetchone()
            if _row_dd:
                _dd = _row_dd.get("date_debut")
                if _dd:
                    try:
                        _new_pd = datetime.strptime(updates["prochaine_date"][:10], "%Y-%m-%d").date()
                        if isinstance(_dd, datetime):
                            _dd_date = _dd.date()
                        elif isinstance(_dd, str):
                            _dd_date = datetime.strptime(_dd[:10], "%Y-%m-%d").date()
                        else:
                            _dd_date = _dd
                        if _new_pd < _dd_date:
                            raise HTTPException(
                                status_code=400,
                                detail=(
                                    f"prochaine_date={updates['prochaine_date']} "
                                    f"est anterieure a date_debut={_dd_date}. "
                                    "Etat logique invalide."
                                ),
                            )
                    except HTTPException:
                        raise
                    except Exception as exc:
                        logger.debug("date validation skip: %s", exc)

        # FIX P2 (B4): coherence auto_envoi_email + email_destinataire.
        # Si on active auto_envoi_email mais qu'aucun email n'est fourni
        # NI dans l'update NI deja en BD, rejeter.
        if updates.get("auto_envoi_email") is True:
            new_email = updates.get("email_destinataire", None)
            if not new_email:
                cursor.execute(
                    "SELECT email_destinataire FROM factures_recurrentes WHERE id = %s",
                    (recurring_id,),
                )
                _row_cur = cursor.fetchone()
                cur_email = (dict(_row_cur).get("email_destinataire") if _row_cur else "") or ""
                if not cur_email.strip():
                    raise HTTPException(
                        status_code=400,
                        detail="email_destinataire requis si auto_envoi_email=true",
                    )

        vals.append(recurring_id)
        cursor.execute(
            f"UPDATE factures_recurrentes SET {', '.join(sets)}, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            vals,
        )

        _log_accounting_action(
            cursor, user, "update", "recurring_invoice", recurring_id,
            details={"fields_updated": list(updates.keys())},
        )
        conn.commit()
        return {"id": recurring_id, "message": "Template modifie"}
    except HTTPException:
        try: conn.rollback()
        except Exception: pass
        raise
    except Exception as exc:
        logger.error("update_recurring_invoice error: %s", exc)
        try: conn.rollback()
        except Exception: pass
        raise HTTPException(status_code=500, detail="Erreur modification template")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        _end_tx(conn, tx_modified)
        conn.close()


@router.delete("/recurring-invoices/{recurring_id}")
async def delete_recurring_invoice(recurring_id: int, user: ErpUser = Depends(get_current_user)):
    """Annule un template (statut=ANNULEE). Les factures deja generees
    restent intactes. Pour suppression definitive, utiliser un admin tool."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_recurring_reminders_tables(cursor)
        cursor.execute(
            "UPDATE factures_recurrentes SET statut = 'ANNULEE', updated_at = CURRENT_TIMESTAMP "
            "WHERE id = %s AND statut != 'ANNULEE' RETURNING id",
            (recurring_id,),
        )
        if not cursor.fetchone():
            cursor.execute("SELECT id FROM factures_recurrentes WHERE id = %s", (recurring_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Template non trouve")
            # Deja ANNULEE: idempotent OK
        _log_accounting_action(cursor, user, "cancel", "recurring_invoice", recurring_id)
        conn.commit()
        return {"id": recurring_id, "message": "Template annule"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_recurring_invoice error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.post("/recurring-invoices/{recurring_id}/pause")
async def pause_recurring_invoice(recurring_id: int, user: ErpUser = Depends(get_current_user)):
    """Pause temporairement la generation automatique."""
    return await _set_recurring_statut(recurring_id, "PAUSEE", user)


@router.post("/recurring-invoices/{recurring_id}/resume")
async def resume_recurring_invoice(recurring_id: int, user: ErpUser = Depends(get_current_user)):
    """Reprend la generation automatique."""
    return await _set_recurring_statut(recurring_id, "ACTIVE", user)


async def _set_recurring_statut(recurring_id: int, new_statut: str, user):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_recurring_reminders_tables(cursor)
        cursor.execute(
            "UPDATE factures_recurrentes SET statut = %s, updated_at = CURRENT_TIMESTAMP "
            "WHERE id = %s AND statut NOT IN ('TERMINEE', 'ANNULEE') RETURNING id, statut",
            (new_statut, recurring_id),
        )
        row = cursor.fetchone()
        if not row:
            cursor.execute("SELECT statut FROM factures_recurrentes WHERE id = %s", (recurring_id,))
            existing = cursor.fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Template non trouve")
            raise HTTPException(
                status_code=400,
                detail=f"Impossible de changer le statut: actuel = {existing['statut']}",
            )
        _log_accounting_action(cursor, user, "update", "recurring_invoice", recurring_id,
                               details={"new_statut": new_statut})
        conn.commit()
        return {"id": recurring_id, "statut": new_statut, "message": "Statut mis a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("_set_recurring_statut error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


def _generate_invoice_from_recurring(cursor, template: dict, user=None) -> Optional[int]:
    """Genere une facture a partir d'un template recurrent.

    Cree une nouvelle facture en BROUILLON (ou ENVOYEE selon template),
    copie les lignes, lie via `facture_recurrente_id`. Met a jour le
    template (nb_occurrences_generees, prochaine_date, derniere_*).

    Retourne l'ID de la facture creee, ou None si template invalide
    (ex: pas de lignes, dates depassees).
    """
    template_id = template["id"]
    nom = template.get("nom") or f"Recurrent #{template_id}"
    client_company_id = template.get("client_company_id")
    project_id = template.get("project_id")
    statut_init = (template.get("statut_facture_genere") or "BROUILLON").upper()

    # template_lignes stored as JSONB
    lignes = template.get("template_lignes") or []
    if isinstance(lignes, str):
        try:
            lignes = json.loads(lignes)
        except Exception:
            lignes = []
    if not lignes:
        logger.warning("Template recurrent %s sans lignes, generation skipee", template_id)
        return None

    # Recuperer le nom du client
    client_nom = ""
    if client_company_id:
        cursor.execute("SELECT nom FROM companies WHERE id = %s", (client_company_id,))
        crow = cursor.fetchone()
        if crow:
            client_nom = dict(crow).get("nom", "")

    today_date = _today_quebec()
    date_facture = str(today_date)
    conditions = template.get("conditions_paiement") or "Net 30"
    payment_days = _parse_payment_days(conditions)
    date_echeance = (today_date + timedelta(days=payment_days)).isoformat()

    # Insert facture en BROUILLON (numero TEMP, ajuste apres)
    cursor.execute(
        "INSERT INTO factures ("
        "  numero_facture, client_company_id, type_destinataire, "
        "  client_nom, project_id, "
        "  date_facture, date_emission, date_echeance, "
        "  conditions_paiement, "
        "  taux_tps, taux_tvq, "
        "  montant_ht, tps, montant_tps, tvq, montant_tvq, "
        "  montant_ttc, montant_total, montant_paye, solde_du, "
        "  statut, notes, notes_internes, "
        "  type_document, facture_recurrente_id, "
        "  created_at"
        ") VALUES ("
        "  %s, %s, 'client', "
        "  %s, %s, "
        "  %s::date, %s::date, %s::date, "
        "  %s, "
        "  5.0, 9.975, "
        "  0, 0, 0, 0, 0, "
        "  0, 0, 0, 0, "
        "  'BROUILLON', %s, %s, "
        "  'FACTURE', %s, "
        "  CURRENT_TIMESTAMP"
        ") RETURNING id",
        (
            'TEMP', client_company_id,
            client_nom, project_id,
            date_facture, date_facture, date_echeance,
            conditions,
            template.get("notes"), template.get("notes_internes"),
            template_id,
        ),
    )
    facture_id = cursor.fetchone()["id"]
    year_str = str(today_date.year)
    numero = f"FACT-{year_str}-{facture_id:05d}"
    cursor.execute("UPDATE factures SET numero_facture = %s WHERE id = %s", (numero, facture_id))

    # Cloner les lignes
    for idx, ln in enumerate(lignes, 1):
        desc = (ln.get("description") or "").strip()
        if not desc:
            continue
        qte = float(ln.get("quantite") or 1)
        prix = float(ln.get("prix_unitaire") or 0)
        montant_l = round(qte * prix, 2)
        cursor.execute(
            "INSERT INTO facture_lignes (facture_id, description, quantite, "
            "prix_unitaire, montant, montant_ligne, sequence_ligne, date_creation, unite) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, %s)",
            (facture_id, desc, qte, prix, montant_l, montant_l, idx,
             ln.get("unite") or "unite"),
        )

    # Recalcul totaux (utilise _recalculate_invoice qui agrege depuis lignes)
    _recalculate_invoice(cursor, facture_id)

    # Bascule auto en ENVOYEE si configure (cree ecriture comptable + email optionnel)
    auto_envoi_email = bool(template.get("auto_envoi_email"))
    email_destinataire = template.get("email_destinataire") or ""
    if statut_init == "ENVOYEE":
        try:
            _ensure_sync_columns(cursor)
            _ensure_facture_compliance_columns(cursor)
            # Figer le snapshot emetteur/client AVANT la generation HTML
            # (conformite Revenu Quebec — comme dans send_invoice_by_email)
            from .html_utils import get_company_info as _gci
            enterprise = _gci(cursor)
            emetteur_snap = _build_emetteur_snapshot(enterprise)
            client_company = None
            if client_company_id:
                cursor.execute("SELECT * FROM companies WHERE id = %s", (client_company_id,))
                _ccr = cursor.fetchone()
                if _ccr:
                    client_company = dict(_ccr)
            client_snap = _build_client_snapshot({
                "client_nom": client_nom,
            }, client_company)
            cursor.execute(
                "UPDATE factures SET "
                "emetteur_snapshot = COALESCE(emetteur_snapshot, %s::jsonb), "
                "client_snapshot = COALESCE(client_snapshot, %s::jsonb), "
                "updated_at = CURRENT_TIMESTAMP "
                "WHERE id = %s",
                (json.dumps(emetteur_snap), json.dumps(client_snap), facture_id),
            )

            je_id = _create_invoice_journal_entry(cursor, facture_id, strict_period=False)
            cursor.execute(
                "UPDATE factures SET statut = 'ENVOYEE', date_envoi = CURRENT_TIMESTAMP, "
                "envoye_par = %s, envoye_a = %s WHERE id = %s",
                ("recurring_cron", email_destinataire if auto_envoi_email else None, facture_id),
            )

            # FIX P0 (A1): envoi email automatique avec PDF si configure
            # Le user a coche "Envoyer automatiquement par courriel" lors de la
            # creation du template — il s'attend a ce que le PDF soit envoye
            # au client sans intervention manuelle. Sans ce bloc, les factures
            # etaient creees + comptabilisees mais aucun email n'etait envoye.
            if auto_envoi_email and email_destinataire:
                try:
                    import re as _re_em_v
                    _email_re = r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
                    if not _re_em_v.match(_email_re, email_destinataire.strip()):
                        logger.warning(
                            "Facture recurrente %s: email_destinataire invalide (%s), envoi auto skipe",
                            facture_id, email_destinataire,
                        )
                    else:
                        # Charger les donnees pour generer HTML+PDF (snapshot deja fige)
                        cursor.execute("SELECT * FROM factures WHERE id = %s", (facture_id,))
                        _fac = dict(cursor.fetchone())
                        cursor.execute(
                            "SELECT * FROM facture_lignes WHERE facture_id = %s ORDER BY id",
                            (facture_id,),
                        )
                        _lignes = [dict(r) for r in cursor.fetchall()]
                        from .html_utils import get_document_theme as _gdt
                        _theme = _gdt(cursor)
                        _html_str = _generate_facture_html(_fac, _lignes, client_company, enterprise, theme=_theme)
                        _pdf_bytes = _generate_invoice_pdf(_html_str)

                        # Envoi via helper SMTP avec PDF en piece jointe
                        from .emails import send_internal_email_with_attachment
                        _ent_name = emetteur_snap.get("nom") or "Entreprise"
                        _from = emetteur_snap.get("courriel") or ""
                        _numero = _fac.get("numero_facture") or f"#{facture_id}"
                        _subject = f"Facture {_numero} - {_ent_name}"
                        _client_nom_safe = (client_snap.get("nom") or "Madame/Monsieur")
                        _ttc = float(_fac.get("montant_ttc") or _fac.get("montant_total") or 0)
                        _date_ech = str(_fac.get("date_echeance", ""))[:10] if _fac.get("date_echeance") else "Non specifiee"
                        _modalites = _fac.get("conditions_paiement") or "Net 30"
                        _body_html = (
                            f"<p>Bonjour {_html.escape(_client_nom_safe, quote=True)},</p>"
                            f"<p>Veuillez trouver ci-joint la facture <strong>#{_html.escape(_numero, quote=True)}</strong> "
                            f"(generee automatiquement selon votre contrat).</p>"
                            f"<p>Montant total: <strong>{_html.escape(_fmt_money(_ttc), quote=True)}</strong><br>"
                            f"Date d'echeance: {_html.escape(_date_ech, quote=True)}<br>"
                            f"Modalites de paiement: {_html.escape(_modalites, quote=True)}</p>"
                            f"<p>Merci pour votre confiance.</p>"
                            f"<p>Cordialement,<br>{_html.escape(_ent_name, quote=True)}</p>"
                        )
                        _body_text = (
                            f"Bonjour {_client_nom_safe},\n\n"
                            f"Veuillez trouver ci-joint la facture #{_numero} (generee automatiquement).\n"
                            f"Montant total: {_fmt_money(_ttc)}\n"
                            f"Date d'echeance: {_date_ech}\n"
                            f"Modalites: {_modalites}\n\n"
                            f"Cordialement,\n{_ent_name}"
                        )
                        import re as _re_fn
                        _numero_safe = _re_fn.sub(r'[^a-zA-Z0-9\-_]', '_', str(_numero))[:64] or f"facture-{facture_id}"
                        sent_ok, send_err = send_internal_email_with_attachment(
                            from_name=_ent_name,
                            from_address=_from,
                            to_email=email_destinataire.strip(),
                            subject=_subject,
                            body_html=_body_html,
                            body_text=_body_text,
                            attachments=[(f"facture-{_numero_safe}.pdf", "application/pdf", _pdf_bytes)],
                        )
                        if not sent_ok:
                            logger.warning(
                                "Facture recurrente %s: envoi email auto echoue (%s)",
                                facture_id, send_err,
                            )
                except Exception as exc_email:
                    # L'envoi email auto est best-effort: si echec, on log mais
                    # on ne rollback PAS la generation de la facture (statut
                    # ENVOYEE + ecriture comptable conservees).
                    logger.warning(
                        "Facture recurrente %s: erreur envoi email auto: %s",
                        facture_id, exc_email,
                    )
        except Exception as exc:
            logger.warning(
                "Facture recurrente %s creee mais transition ENVOYEE echouee: %s — "
                "reste en BROUILLON",
                facture_id, exc,
            )

    # Mise a jour du template — IMPORTANT: calculer la PROCHAINE date a partir
    # de l'ANCIENNE prochaine_date (pas de today). Sinon, si le cron rate un
    # jour (panne serveur, week-end ferie), le calendrier glisse cumulativement.
    # Ex: prochaine_date = 2026-07-15, cron tourne le 2026-07-17 (2 jours en
    # retard). Avec today: next = 2026-08-17. Avec prochaine_date: 2026-08-15.
    # Le calendrier reste sur le 15 du mois comme prevu.
    base_for_next = template.get("prochaine_date") or today_date
    if isinstance(base_for_next, str):
        try:
            base_for_next = datetime.strptime(base_for_next[:10], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            base_for_next = today_date
    elif isinstance(base_for_next, datetime):
        base_for_next = base_for_next.date()
    next_date = _compute_next_date(base_for_next, template["frequence"], int(template.get("interval_count") or 1))
    cursor.execute(
        "UPDATE factures_recurrentes SET "
        "  nb_occurrences_generees = nb_occurrences_generees + 1, "
        "  derniere_generation_le = CURRENT_TIMESTAMP, "
        "  derniere_facture_id = %s, "
        "  prochaine_date = %s::date, "
        "  updated_at = CURRENT_TIMESTAMP "
        "WHERE id = %s",
        (facture_id, next_date.isoformat(), template_id),
    )

    # Verifier si on doit terminer (nb_occurrences_max atteint ou date_fin depassee)
    nb_max = template.get("nb_occurrences_max")
    date_fin = template.get("date_fin")
    new_nb = int(template.get("nb_occurrences_generees") or 0) + 1
    should_terminate = False
    if nb_max is not None and new_nb >= int(nb_max):
        should_terminate = True
    if date_fin:
        df = date_fin
        if isinstance(df, str):
            df = datetime.strptime(df[:10], "%Y-%m-%d").date()
        if next_date > df:
            should_terminate = True
    if should_terminate:
        cursor.execute(
            "UPDATE factures_recurrentes SET statut = 'TERMINEE', "
            "updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (template_id,),
        )

    _log_accounting_action(
        cursor, user, "auto_generate", "invoice", facture_id,
        details={
            "from_recurring_id": template_id,
            "occurrence_no": new_nb,
            "next_date": next_date.isoformat(),
            "terminated": should_terminate,
        },
    )

    return facture_id


@router.post("/recurring-invoices/{recurring_id}/generate-now")
async def generate_recurring_now(recurring_id: int, user: ErpUser = Depends(get_current_user)):
    """Force la generation immediate d'une facture depuis ce template.
    Met a jour `prochaine_date` selon la frequence (comme si le cron
    l'avait declenchee aujourd'hui)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_recurring_reminders_tables(cursor)
        cursor.execute(
            "SELECT * FROM factures_recurrentes WHERE id = %s FOR UPDATE",
            (recurring_id,),
        )
        template = cursor.fetchone()
        if not template:
            raise HTTPException(status_code=404, detail="Template non trouve")
        template = _serialize_recurring(template)
        if template["statut"] in ("TERMINEE", "ANNULEE"):
            raise HTTPException(
                status_code=400,
                detail=f"Template {template['statut']} — generation impossible",
            )

        # FIX P1 (R2): idempotence — empecher de generer 2 factures pour le
        # meme template le meme jour (cas: user double-clic OU cron tourne
        # en concurrence avec generate-now manuel).
        derniere_gen = template.get("derniere_generation_le")
        if derniere_gen:
            try:
                _dg = derniere_gen
                if isinstance(_dg, str):
                    _dg = datetime.fromisoformat(_dg.replace("Z", "+00:00")) if "T" in _dg or "+" in _dg else datetime.strptime(_dg[:19], "%Y-%m-%d %H:%M:%S")
                if isinstance(_dg, datetime):
                    _dg = _dg.date()
                if _dg == _today_quebec():
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Une facture a deja ete generee aujourd'hui pour ce template "
                            f"(derniere_facture_id={template.get('derniere_facture_id')}). "
                            "Attendez demain pour une nouvelle generation, ou modifiez "
                            "prochaine_date manuellement."
                        ),
                    )
            except HTTPException:
                raise
            except Exception:
                pass  # Si parse echec, laisser passer (defensif)

        facture_id = _generate_invoice_from_recurring(cursor, template, user=user)
        if not facture_id:
            raise HTTPException(
                status_code=400,
                detail="Generation echouee — verifier que le template a des lignes valides",
            )

        conn.commit()
        return {
            "id": facture_id,
            "recurring_id": recurring_id,
            "message": "Facture generee depuis le template",
        }
    except HTTPException:
        try: conn.rollback()
        except Exception: pass
        raise
    except Exception as exc:
        logger.error("generate_recurring_now error: %s", exc)
        try: conn.rollback()
        except Exception: pass
        raise HTTPException(status_code=500, detail="Erreur generation immediate")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        _end_tx(conn, tx_modified)
        conn.close()


# ============================================================
# RAPPELS DE PAIEMENT (Reminders J+3/15/30/60)
# ============================================================

def _send_reminder(cursor, facture: dict, niveau: int, user=None,
                   to_email_override: Optional[str] = None,
                   message_override: Optional[str] = None,
                   auto: bool = False) -> int:
    """Envoie un rappel de paiement par courriel et l'enregistre.

    Retourne l'ID du rappel cree dans factures_rappels.
    Raise HTTPException si email destination manquant ou SMTP fail.
    """
    facture_id = facture["id"]
    numero = facture.get("numero_facture") or f"#{facture_id}"
    client_nom = facture.get("client_nom") or "Madame/Monsieur"
    solde_du = float(facture.get("solde_du") or facture.get("montant_ttc") or 0)
    date_echeance_str = str(facture.get("date_echeance", ""))[:10] if facture.get("date_echeance") else ""

    # Determiner destinataire
    to_email = to_email_override or facture.get("client_email") or ""
    if not to_email:
        # Fallback: chercher l'email du client_company
        cid = facture.get("client_company_id")
        if cid:
            cursor.execute("SELECT email FROM companies WHERE id = %s", (cid,))
            crow = cursor.fetchone()
            if crow and crow.get("email"):
                to_email = crow["email"]
    if not to_email:
        raise HTTPException(
            status_code=400,
            detail="Aucune adresse courriel destinataire (ni override ni client.email)",
        )

    # Snapshot emetteur (utilise le snapshot fige sur la facture si dispo)
    emetteur_snap = facture.get("emetteur_snapshot")
    if isinstance(emetteur_snap, str):
        try:
            emetteur_snap = json.loads(emetteur_snap)
        except Exception:
            emetteur_snap = None
    if not isinstance(emetteur_snap, dict):
        from .html_utils import get_company_info as _gci
        emetteur_snap = _build_emetteur_snapshot(_gci(cursor))

    ent_name = emetteur_snap.get("nom") or "Entreprise"
    from_address = emetteur_snap.get("courriel") or ""

    # Calcul jours de retard
    jours_retard = 0
    if date_echeance_str:
        try:
            d_ech = datetime.strptime(date_echeance_str, "%Y-%m-%d").date()
            # FIX P1 (B1): timezone Toronto pour eviter decalage 1 jour si
            # cron tourne en soiree EDT (UTC = lendemain).
            jours_retard = max(0, (_today_quebec() - d_ech).days)
        except ValueError:
            pass

    # Construction du message selon niveau (ton progressif)
    niveau_info = REMINDER_LEVELS.get(niveau, REMINDER_LEVELS[1])
    ton = niveau_info["ton"]

    def _e(v):
        return _html.escape(str(v) if v is not None else "", quote=True)

    if message_override:
        body_html = f"<p>{_e(message_override).replace(chr(10), '<br>')}</p>"
        body_text = message_override
    else:
        # Templates progressifs (courtois -> mise en demeure)
        if ton == "courtois":
            intro = (
                "Nous nous permettons de vous rappeler que la facture ci-dessous "
                "est arrivee a echeance recemment et reste en attente de paiement."
            )
            closing = "Si le paiement a deja ete effectue, veuillez ignorer ce rappel."
        elif ton == "ferme":
            intro = (
                f"Notre facture est en retard de {jours_retard} jours. "
                "Nous vous remercions de proceder au paiement dans les meilleurs delais."
            )
            closing = (
                "En cas de difficulte, contactez-nous pour convenir d'un arrangement. "
                "Si le paiement est en cours, merci de nous le confirmer."
            )
        elif ton == "insistant":
            intro = (
                f"Cette facture est en retard de {jours_retard} jours et a deja "
                "fait l'objet de rappels precedents. Le solde demeure impaye."
            )
            closing = (
                "A defaut de reglement dans les 7 jours, nous nous reservons le droit "
                "de transmettre ce dossier a notre service de recouvrement."
            )
        else:  # mise_en_demeure
            intro = (
                f"<strong>Mise en demeure formelle.</strong> Malgre nos relances precedentes, "
                f"cette facture demeure impayee depuis {jours_retard} jours."
            )
            closing = (
                "Si le paiement integral n'est pas recu dans les 10 jours suivant ce courriel, "
                "nous engagerons une procedure de recouvrement et toute action legale jugee "
                "necessaire pour le recouvrement de la creance, incluant des frais "
                "supplementaires conformement aux conditions du contrat."
            )

        body_html = (
            f"<p>Bonjour {_e(client_nom)},</p>"
            f"<p>{intro}</p>"
            f"<p><strong>Facture:</strong> {_e(numero)}<br>"
            f"<strong>Montant du:</strong> {_e(_fmt_money(solde_du))}<br>"
            f"<strong>Date d'echeance:</strong> {_e(date_echeance_str)}<br>"
            f"<strong>Retard:</strong> {jours_retard} jour(s)</p>"
            f"<p>{closing}</p>"
            f"<p>Cordialement,<br>{_e(ent_name)}</p>"
        )
        body_text = (
            f"Bonjour {client_nom},\n\n"
            f"{intro.replace('<strong>', '').replace('</strong>', '')}\n\n"
            f"Facture: {numero}\n"
            f"Montant du: {_fmt_money(solde_du)}\n"
            f"Date d'echeance: {date_echeance_str}\n"
            f"Retard: {jours_retard} jour(s)\n\n"
            f"{closing}\n\n"
            f"Cordialement,\n{ent_name}"
        )

    subject_prefix = "Mise en demeure" if ton == "mise_en_demeure" else "Rappel"
    subject = f"{subject_prefix} - Facture {numero} - {ent_name}"

    # Envoi via le helper SMTP (sans piece jointe par defaut — leger pour rappel)
    from .emails import _send_smtp_internal
    sent_ok, err = _send_smtp_internal(
        from_name=ent_name,
        from_address=from_address,
        to_email=to_email,
        subject=subject,
        body_html=body_html,
        body_text=body_text,
    )

    statut_rappel = "ENVOYE" if sent_ok else "ECHEC"
    erreur = None if sent_ok else (err or "Echec inconnu")

    # Insert dans factures_rappels
    cursor.execute(
        "INSERT INTO factures_rappels ("
        "  facture_id, niveau, date_envoi, destinataire, sujet, "
        "  statut, erreur, envoye_par, auto, created_at"
        ") VALUES ("
        "  %s, %s, CURRENT_TIMESTAMP, %s, %s, "
        "  %s, %s, %s, %s, CURRENT_TIMESTAMP"
        ") RETURNING id",
        (
            facture_id, niveau, to_email, subject,
            statut_rappel, erreur,
            (getattr(user, "email", None) if user else "cron_daily") or "cron_daily",
            auto,
        ),
    )
    rappel_id = cursor.fetchone()["id"]

    # Mise a jour facture
    if sent_ok:
        cursor.execute(
            "UPDATE factures SET "
            "  dernier_rappel_le = CURRENT_TIMESTAMP, "
            "  nb_rappels_envoyes = COALESCE(nb_rappels_envoyes, 0) + 1, "
            "  updated_at = CURRENT_TIMESTAMP "
            "WHERE id = %s",
            (facture_id,),
        )

    _log_accounting_action(
        cursor, user, "send_reminder", "invoice", facture_id,
        details={"niveau": niveau, "auto": auto, "statut": statut_rappel, "erreur": erreur},
    )

    if not sent_ok:
        raise HTTPException(
            status_code=502,
            detail=f"Echec d'envoi du rappel: {erreur}",
        )

    return rappel_id


@router.post("/invoices/{invoice_id}/send-reminder")
async def send_invoice_reminder(
    invoice_id: int,
    body: ReminderSendRequest,
    user: ErpUser = Depends(get_current_user),
):
    """Envoie manuellement un rappel de paiement pour une facture.

    `niveau` 1-4 mappe sur J+3/15/30/60 (ton progressif courtois -> mise
    en demeure). Le rappel est envoye par courriel et enregistre dans
    `factures_rappels` pour audit.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_recurring_reminders_tables(cursor)

        cursor.execute("SELECT * FROM factures WHERE id = %s FOR UPDATE", (invoice_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Facture non trouvee")
        facture = dict(row)

        if facture.get("statut") not in ("ENVOYEE", "PARTIELLEMENT_PAYEE", "EN_RETARD"):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Rappel possible uniquement pour factures ENVOYEE, "
                    "PARTIELLEMENT_PAYEE ou EN_RETARD."
                ),
            )

        rappel_id = _send_reminder(
            cursor, facture, body.niveau, user=user,
            to_email_override=body.to_email_override,
            message_override=body.message_override,
            auto=body.auto,
        )
        conn.commit()
        return {
            "id": rappel_id,
            "invoice_id": invoice_id,
            "niveau": body.niveau,
            "message": "Rappel envoye",
        }
    except HTTPException:
        try: conn.rollback()
        except Exception: pass
        raise
    except Exception as exc:
        # FIX P1 (R4): detecter UniqueViolation sur uq_fact_rappels_niveau_envoye
        # (rappel meme niveau deja ENVOYE pour cette facture). Retourner 409
        # Conflict avec message clair au lieu d'un 500 cryptique.
        import psycopg2 as _psy
        try: conn.rollback()
        except Exception: pass
        # psycopg2.errors.UniqueViolation est une sous-classe d'IntegrityError
        if isinstance(exc, getattr(_psy, "IntegrityError", Exception)):
            err_str = str(exc).lower()
            if "uq_fact_rappels" in err_str or "duplicate key" in err_str:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Un rappel de niveau {body.niveau} a deja ete envoye "
                        "avec succes pour cette facture. Pour relancer, utilisez "
                        "un niveau superieur ou attendez l'echec du precedent."
                    ),
                )
        logger.error("send_invoice_reminder error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur envoi rappel")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        _end_tx(conn, tx_modified)
        conn.close()


@router.get("/invoices/{invoice_id}/reminders")
async def list_invoice_reminders(invoice_id: int, user: ErpUser = Depends(get_current_user)):
    """Historique des rappels envoyes pour une facture."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_recurring_reminders_tables(cursor)
        cursor.execute(
            "SELECT id, facture_id, niveau, date_envoi, destinataire, sujet, "
            "statut, erreur, envoye_par, auto, created_at "
            "FROM factures_rappels WHERE facture_id = %s ORDER BY date_envoi DESC",
            (invoice_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_envoi", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_invoice_reminders error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.put("/invoices/{invoice_id}/reminders/toggle")
async def toggle_invoice_reminders(invoice_id: int, user: ErpUser = Depends(get_current_user)):
    """Active/desactive les rappels automatiques pour cette facture.
    Le rappel manuel reste toujours possible via /send-reminder."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_recurring_reminders_tables(cursor)
        cursor.execute(
            "UPDATE factures SET rappels_actifs = NOT COALESCE(rappels_actifs, TRUE), "
            "updated_at = CURRENT_TIMESTAMP WHERE id = %s RETURNING rappels_actifs",
            (invoice_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Facture non trouvee")
        new_state = bool(row["rappels_actifs"])
        _log_accounting_action(cursor, user, "update", "invoice", invoice_id,
                               details={"rappels_actifs": new_state})
        conn.commit()
        return {"id": invoice_id, "rappels_actifs": new_state}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("toggle_invoice_reminders error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


# ============================================================
# CRON QUOTIDIEN — Bascule EN_RETARD + Generation recurrentes + Rappels auto
# ============================================================

@router.post("/cron/daily")
async def cron_daily_invoicing(request: Request):
    """Endpoint cron quotidien — a appeler par un scheduler externe
    (Render Cron Jobs, GitHub Actions, cron-job.org).

    Authentication: header `X-Cron-Token: <CRON_SECRET>` (env var).
    Pas de get_current_user pour permettre l'appel depuis un service
    automatise sans JWT user.

    Traite, pour CHAQUE tenant actif:
    1. Bascule en EN_RETARD les factures dont date_echeance < today
       et solde_du > 0 et statut in (ENVOYEE, PARTIELLEMENT_PAYEE)
    2. Genere les factures recurrentes dont prochaine_date <= today
    3. Envoie les rappels automatiques selon les niveaux J+3/15/30/60

    Retourne stats par tenant.
    """
    import os as _os_cron
    import hmac as _hmac_cron
    expected_token = _os_cron.environ.get("CRON_SECRET", "")
    if not expected_token:
        raise HTTPException(
            status_code=503,
            detail="CRON_SECRET non configure sur le serveur",
        )
    header_token = request.headers.get("x-cron-token") or request.headers.get("X-Cron-Token") or ""
    # Comparaison timing-safe pour eviter les timing attacks (defense-in-depth).
    # `hmac.compare_digest` prend un temps constant peu importe ou la divergence
    # se produit dans la chaine.
    if not header_token or not _hmac_cron.compare_digest(header_token, expected_token):
        raise HTTPException(status_code=401, detail="Token cron invalide")

    # Lister tous les tenants actifs (schema public.entreprises)
    conn = db.get_conn()
    cursor = None
    stats = {
        "tenants_processed": 0,
        "tenants_failed": 0,
        "factures_overdue_marked": 0,
        "recurring_generated": 0,
        "reminders_sent": 0,
        "reminders_failed": 0,
        "per_tenant": [],
    }
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT schema_name, nom FROM public.entreprises "
            "WHERE active = TRUE AND schema_name LIKE 'tenant_%%' "
            "ORDER BY id"
        )
        tenants = [(r["schema_name"], r.get("nom")) for r in cursor.fetchall()]
    except Exception as exc:
        logger.error("cron_daily: lecture tenants echouee: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lecture tenants")
    finally:
        if cursor:
            cursor.close()
        conn.close()

    today_iso = _today_quebec().isoformat()

    for schema_name, tenant_nom in tenants:
        per_tenant = {
            "schema": schema_name, "nom": tenant_nom,
            "overdue": 0, "recurring": 0, "reminders": 0, "reminder_errors": 0,
            "errors": [],
        }
        t_conn = db.get_conn()
        t_cursor = None
        t_tx_modified = False
        try:
            # IMPORTANT: activer le mode transactionnel pour que SAVEPOINT et
            # SELECT FOR UPDATE fonctionnent. Sans _begin_tx, le pool reste
            # en autocommit (chaque statement commit individuellement) et:
            # - SAVEPOINT devient no-op silencieux (_savepoint_create log warn)
            # - SELECT FOR UPDATE ne tient pas le lock entre statements
            # - En cas de plantage milieu de boucle: factures orphelines
            #   sans lignes + rollback partiel impossible
            t_tx_modified = _begin_tx(t_conn)
            db.set_tenant(t_conn, schema_name)
            t_cursor = t_conn.cursor()
            _ensure_facture_compliance_columns(t_cursor)
            _ensure_recurring_reminders_tables(t_cursor)

            # 1. Bascule EN_RETARD
            try:
                t_cursor.execute(
                    "UPDATE factures SET statut = 'EN_RETARD', updated_at = CURRENT_TIMESTAMP "
                    "WHERE date_echeance < %s::date AND solde_du > 0 "
                    "AND statut IN ('ENVOYEE', 'PARTIELLEMENT_PAYEE')",
                    (today_iso,),
                )
                per_tenant["overdue"] = t_cursor.rowcount or 0
                stats["factures_overdue_marked"] += per_tenant["overdue"]
            except Exception as exc:
                per_tenant["errors"].append(f"overdue: {exc}")
                logger.warning("cron[%s] overdue echec: %s", schema_name, exc)

            # 2. Generation des factures recurrentes du jour
            try:
                t_cursor.execute(
                    "SELECT * FROM factures_recurrentes "
                    "WHERE statut = 'ACTIVE' AND prochaine_date <= %s::date "
                    "ORDER BY prochaine_date ASC FOR UPDATE",
                    (today_iso,),
                )
                templates = [_serialize_recurring(r) for r in t_cursor.fetchall()]
                # FIX P1 (T6): cap rattrapage a 12 occurrences max par template
                # par cron run. Si un template avait prochaine_date il y a 6 mois
                # (panne serveur prolongee), on rattrape jusqu'a 12 occurrences
                # dans le meme run au lieu d'etaler sur 12 jours consecutifs.
                CAP_RATTRAPAGE = 12
                today_qc = _today_quebec()
                for tpl in templates:
                    sp_name = f"sp_rec_{tpl['id']}"
                    sp_created = _savepoint_create(t_cursor, sp_name)
                    try:
                        n_iters = 0
                        current_tpl = tpl
                        while n_iters < CAP_RATTRAPAGE:
                            fid = _generate_invoice_from_recurring(t_cursor, current_tpl)
                            if not fid:
                                break  # generation echouee (template sans lignes par ex)
                            per_tenant["recurring"] += 1
                            stats["recurring_generated"] += 1
                            n_iters += 1
                            # Recharger le template pour lire prochaine_date avancee
                            t_cursor.execute(
                                "SELECT * FROM factures_recurrentes WHERE id = %s",
                                (current_tpl["id"],),
                            )
                            _row = t_cursor.fetchone()
                            if not _row:
                                break
                            current_tpl = _serialize_recurring(_row)
                            # Stop si template termine ou plus due
                            if current_tpl.get("statut") != "ACTIVE":
                                break
                            pdate = current_tpl.get("prochaine_date")
                            if isinstance(pdate, str):
                                try:
                                    pdate = datetime.strptime(pdate[:10], "%Y-%m-%d").date()
                                except Exception:
                                    break
                            if pdate is None or pdate > today_qc:
                                break
                        if n_iters >= CAP_RATTRAPAGE:
                            per_tenant["errors"].append(
                                f"recurring #{tpl['id']}: cap rattrapage {CAP_RATTRAPAGE} atteint — generations supplementaires reportees au prochain cron"
                            )
                            logger.warning(
                                "cron[%s] recurring #%s: cap rattrapage %d atteint",
                                schema_name, tpl["id"], CAP_RATTRAPAGE,
                            )
                        if sp_created:
                            _savepoint_release(t_cursor, sp_name)
                    except Exception as exc:
                        if sp_created:
                            _savepoint_rollback(t_cursor, sp_name)
                        per_tenant["errors"].append(f"recurring #{tpl['id']}: {exc}")
                        logger.warning("cron[%s] recurring #%s: %s", schema_name, tpl["id"], exc)
            except Exception as exc:
                per_tenant["errors"].append(f"recurring_list: {exc}")
                logger.warning("cron[%s] recurring_list: %s", schema_name, exc)

            # 3. Rappels automatiques
            try:
                # Factures candidates: EN_RETARD + rappels_actifs + solde_du > 0
                t_cursor.execute(
                    "SELECT f.*, "
                    # FIX P0: filtrer sur statut='ENVOYE' uniquement. Sans ce
                    # filtre, un rappel ECHEC compterait comme "dernier_niveau"
                    # et le retry au prochain cron sauterait directement au
                    # niveau supérieur (saut brutal). Avec le filtre, un ECHEC
                    # ne bloque pas la re-tentative au même niveau.
                    "(SELECT MAX(niveau) FROM factures_rappels r WHERE r.facture_id = f.id AND r.statut = 'ENVOYE') AS dernier_niveau "
                    # FIX P2 (BUG-H2): subquery dernier_envoi inutilisee supprimee
                    "FROM factures f "
                    # Inclure ENVOYEE pour resilience: si le pass 'overdue' (phase 1)
                    # plante avant cette phase, les factures depassant date_echeance
                    # sont encore en ENVOYEE/PARTIELLEMENT_PAYEE. On filtre via
                    # date_echeance < today AND solde_du > 0 directement.
                    "WHERE f.statut IN ('ENVOYEE', 'PARTIELLEMENT_PAYEE', 'EN_RETARD') "
                    "AND COALESCE(f.rappels_actifs, TRUE) = TRUE "
                    "AND COALESCE(f.solde_du, 0) > 0 "
                    "AND f.date_echeance IS NOT NULL "
                    "AND f.date_echeance < %s::date "
                    "FOR UPDATE OF f",
                    (today_iso,),
                )
                candidates = [dict(r) for r in t_cursor.fetchall()]

                for fac in candidates:
                    # FIX P0 (BUG-H1): initialiser AVANT le try interne pour eviter
                    # UnboundLocalError dans except si exception levee avant
                    # _savepoint_create (ex: SELECT email companies plante,
                    # UPDATE rappels_actifs plante, strptime date_echeance plante).
                    sp_rem_created = False
                    sp_rem = None
                    try:
                        # FIX P1 (G1): pre-check email destinataire. Si aucun
                        # email (client_email NULL + companies.email NULL),
                        # marquer rappels_actifs=FALSE pour eviter le retry
                        # quotidien qui pollue les logs et l'audit.
                        fac_email = fac.get("client_email") or ""
                        if not fac_email and fac.get("client_company_id"):
                            t_cursor.execute(
                                "SELECT email FROM companies WHERE id = %s",
                                (fac["client_company_id"],),
                            )
                            _crow = t_cursor.fetchone()
                            if _crow:
                                fac_email = _crow.get("email") or ""
                        if not fac_email:
                            # Auto-desactiver pour eviter spam quotidien
                            t_cursor.execute(
                                "UPDATE factures SET rappels_actifs = FALSE, "
                                "updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                                (fac["id"],),
                            )
                            per_tenant["errors"].append(
                                f"fac#{fac['id']}: rappels desactives auto (aucun email destinataire)"
                            )
                            logger.info(
                                "cron[%s] fac#%s: rappels auto-desactives (email NULL)",
                                schema_name, fac["id"],
                            )
                            continue

                        date_ech = fac.get("date_echeance")
                        if hasattr(date_ech, "isoformat"):
                            d_ech = date_ech
                        else:
                            d_ech = datetime.strptime(str(date_ech)[:10], "%Y-%m-%d").date()
                        # FIX P1 (B1): timezone Toronto coherent avec le SELECT
                        jours_retard = (_today_quebec() - d_ech).days
                        dernier_niveau = fac.get("dernier_niveau") or 0

                        # Determiner le prochain niveau a envoyer (1-4)
                        # FIX P1 (B1): envoyer le PLUS BAS niveau non encore envoye
                        # (au lieu du plus haut atteint). Si un client a J+60 sans
                        # rappels precedents, on envoie d'abord niveau 1 (courtois),
                        # puis 2/3/4 aux prochains crons. Evite la mise en demeure
                        # brutale sans gradation prealable (obligation de bonne foi
                        # Code civil Quebec).
                        target_niveau = None
                        for lvl in (1, 2, 3, 4):
                            if jours_retard >= REMINDER_LEVELS[lvl]["jours_apres_echeance"] and dernier_niveau < lvl:
                                target_niveau = lvl
                                break
                        if not target_niveau:
                            continue

                        # SAVEPOINT par facture pour isoler les SMTP failures
                        # et eviter le rollback en cascade des rappels precedents.
                        sp_rem = f"sp_rem_{fac['id']}_{target_niveau}"
                        sp_rem_created = _savepoint_create(t_cursor, sp_rem)
                        try:
                            _send_reminder(t_cursor, fac, target_niveau, auto=True)
                            per_tenant["reminders"] += 1
                            stats["reminders_sent"] += 1
                            if sp_rem_created:
                                _savepoint_release(t_cursor, sp_rem)
                        except HTTPException as hex_:
                            # FIX P0 (B-P0-2): RELEASE le savepoint (pas rollback)
                            # pour preserver l'INSERT du rappel ECHEC dans
                            # factures_rappels. Audit trail conserve (norme 7
                            # ans Revenu Quebec + Loi 25 Quebec). Le filtre
                            # MAX(niveau) WHERE statut='ENVOYE' garantit qu'un
                            # ECHEC ne bloque pas le retry au meme niveau au
                            # prochain cron.
                            if sp_rem_created:
                                _savepoint_release(t_cursor, sp_rem)
                            per_tenant["reminder_errors"] += 1
                            stats["reminders_failed"] += 1
                            per_tenant["errors"].append(
                                f"reminder fac#{fac['id']} lvl{target_niveau}: {hex_.detail}"
                            )
                    except Exception as exc:
                        # FIX P0 (B3): rollback du savepoint AUSSI sur Exception
                        # non-HTTP (ex: psycopg2.IntegrityError, BD lock). Sans
                        # rollback ici, la tx Postgres entre en "aborted state"
                        # et tous les rappels suivants du tenant echouent en
                        # cascade avec "current transaction is aborted".
                        if sp_rem_created:
                            _savepoint_rollback(t_cursor, sp_rem)
                        per_tenant["reminder_errors"] += 1
                        per_tenant["errors"].append(f"reminder fac#{fac.get('id')}: {exc}")
                        logger.warning("cron[%s] reminder fac#%s: %s",
                                       schema_name, fac.get("id"), exc)
            except Exception as exc:
                per_tenant["errors"].append(f"reminders_list: {exc}")
                logger.warning("cron[%s] reminders_list: %s", schema_name, exc)

            try:
                t_conn.commit()
            except Exception as exc:
                logger.warning("cron[%s] commit warning: %s", schema_name, exc)

            stats["tenants_processed"] += 1
        except Exception as exc:
            stats["tenants_failed"] += 1
            per_tenant["errors"].append(f"fatal: {exc}")
            logger.error("cron[%s] fatal: %s", schema_name, exc)
            try: t_conn.rollback()
            except Exception: pass
        finally:
            if t_cursor:
                t_cursor.close()
            try: db.reset_tenant(t_conn)
            except Exception: pass
            # Restaurer l'autocommit du pool avant fermeture (pendant de _begin_tx)
            _end_tx(t_conn, t_tx_modified)
            t_conn.close()

        stats["per_tenant"].append(per_tenant)

    return {
        "message": "Cron daily processed",
        "date": today_iso,
        **stats,
    }


# ============================================================
# RETENUES DE CHANTIER (Construction Holdbacks)
# ============================================================

class HoldbackCreate(BaseModel):
    facture_id: int
    montant_retenu: Optional[float] = None
    taux_retenue: float = 10.0
    date_fin_travaux: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("date_fin_travaux", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


class HoldbackRelease(BaseModel):
    date_liberation: Optional[str] = None
    montant_libere: Optional[float] = None

    @field_validator("date_liberation", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


def _ensure_retenues_table(cursor):
    cursor.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_name = 'retenues_chantier' AND table_schema = current_schema()"
    )
    if not cursor.fetchone():
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS retenues_chantier (
                    id SERIAL PRIMARY KEY, facture_id INTEGER NOT NULL,
                    montant_retenu NUMERIC(14,2) NOT NULL, taux_retenue NUMERIC(5,2) DEFAULT 10.00,
                    date_fin_travaux DATE, date_liberation DATE,
                    statut VARCHAR(20) DEFAULT 'RETENUE',
                    journal_entry_retenue_id INTEGER, journal_entry_liberation_id INTEGER,
                    notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
            """)
        except Exception as exc:
            logger.warning("_ensure retenues_chantier: %s", exc)
            pass
    cursor.execute(
        "INSERT INTO plan_comptable (code, nom, type, classe, solde_normal, actif) "
        "VALUES ('1150', 'Retenues a recevoir', 'ACTIF', 1, 'DEBIT', TRUE) "
        "ON CONFLICT (code) DO NOTHING")


@router.get("/holdbacks")
async def list_holdbacks(user: ErpUser = Depends(get_current_user), statut: Optional[str] = None,
                         page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=100)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_retenues_table(cursor)
        wheres, params = [], []
        if statut:
            wheres.append("r.statut = %s"); params.append(statut)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM retenues_chantier r WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT r.*, f.numero_facture, f.client_nom FROM retenues_chantier r "
            f"LEFT JOIN factures f ON f.id = r.facture_id WHERE {w} ORDER BY r.created_at DESC LIMIT %s OFFSET %s",
            params + [per_page, offset])
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_fin_travaux", "date_liberation", "created_at", "updated_at"):
                if d.get(k): d[k] = str(d[k])
            for k in ("montant_retenu", "taux_retenue"):
                if d.get(k) is not None: d[k] = float(d[k])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_holdbacks error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.post("/holdbacks")
async def create_holdback(body: HoldbackCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_retenues_table(cursor)
        cursor.execute("SELECT id, numero_facture, COALESCE(NULLIF(montant_total,0), montant_ttc, 0) as ttc, client_nom, project_id FROM factures WHERE id = %s", (body.facture_id,))
        fac = cursor.fetchone()
        if not fac:
            raise HTTPException(status_code=404, detail="Facture non trouvee")
        ttc = float(fac["ttc"])
        montant = body.montant_retenu if body.montant_retenu else round(ttc * body.taux_retenue / 100, 2)
        cursor.execute(
            "INSERT INTO retenues_chantier (facture_id, montant_retenu, taux_retenue, date_fin_travaux, notes, created_at) "
            "VALUES (%s,%s,%s,%s,%s,CURRENT_TIMESTAMP) RETURNING id",
            (body.facture_id, montant, body.taux_retenue, body.date_fin_travaux, body.notes))
        holdback_id = cursor.fetchone()["id"]
        # Journal: Debit 1150 / Credit 1100
        journal_id = None
        try:
            cursor.execute("SELECT id FROM plan_comptable WHERE code = '1150' AND actif = TRUE")
            a1150 = cursor.fetchone()
            cursor.execute("SELECT id FROM plan_comptable WHERE code = '1100' AND actif = TRUE")
            a1100 = cursor.fetchone()
            if a1150 and a1100:
                nf = fac.get("numero_facture") or str(body.facture_id)
                cursor.execute(
                    "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, libelle, type_journal, source_type, source_id, montant_total, statut, validated_at, created_at) "
                    "VALUES ('TEMP', CURRENT_DATE, CURRENT_DATE, %s, 'RETENUE', 'retenue_chantier', %s, %s, 'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                    (f"Retenue 10% - Facture {nf}", holdback_id, montant))
                journal_id = cursor.fetchone()["id"]
                cursor.execute("UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s", (f"JE-RET-{journal_id:05d}", journal_id))
                for code, acct_id, is_debit in [('1150', a1150["id"], True), ('1100', a1100["id"], False)]:
                    cursor.execute(
                        "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, libelle, debit, credit, projet_id, sequence, created_at) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP)",
                        (journal_id, acct_id, code, f"Retenue - {nf}", montant if is_debit else 0, 0 if is_debit else montant, fac.get("project_id"), 1 if is_debit else 2))
                cursor.execute("UPDATE retenues_chantier SET journal_entry_retenue_id = %s WHERE id = %s", (journal_id, holdback_id))
        except Exception as e:
            logger.warning("Holdback journal failed: %s", e)
        return {"id": holdback_id, "montant_retenu": montant, "journal_entry_id": journal_id, "message": "Retenue creee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_holdback error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.put("/holdbacks/{holdback_id}/release")
async def release_holdback(holdback_id: int, body: HoldbackRelease = None, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if body is None:
        body = HoldbackRelease()
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_retenues_table(cursor)
        cursor.execute("SELECT r.*, f.numero_facture, f.project_id FROM retenues_chantier r LEFT JOIN factures f ON f.id = r.facture_id WHERE r.id = %s", (holdback_id,))
        row = cursor.fetchone()
        if not row: raise HTTPException(status_code=404, detail="Retenue non trouvee")
        if row["statut"] == "LIBEREE": raise HTTPException(status_code=400, detail="Retenue deja liberee")
        montant = float(body.montant_libere or row["montant_retenu"])
        date_lib = body.date_liberation or str(date.today())
        cursor.execute("UPDATE retenues_chantier SET statut = 'LIBEREE', date_liberation = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (date_lib, holdback_id))
        # Journal: Debit 1010 / Credit 1150
        journal_id = None
        try:
            cursor.execute("SELECT id FROM plan_comptable WHERE code = '1010' AND actif = TRUE")
            a1010 = cursor.fetchone()
            cursor.execute("SELECT id FROM plan_comptable WHERE code = '1150' AND actif = TRUE")
            a1150 = cursor.fetchone()
            if a1010 and a1150:
                nf = row.get("numero_facture") or str(row["facture_id"])
                cursor.execute(
                    "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, libelle, type_journal, source_type, source_id, montant_total, statut, validated_at, created_at) "
                    "VALUES ('TEMP', %s, %s, %s, 'LIBERATION_RETENUE', 'retenue_chantier', %s, %s, 'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
                    (date_lib, date_lib, f"Liberation retenue - Facture {nf}", holdback_id, montant))
                journal_id = cursor.fetchone()["id"]
                cursor.execute("UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s", (f"JE-LIB-{journal_id:05d}", journal_id))
                for code, acct_id, is_debit in [('1010', a1010["id"], True), ('1150', a1150["id"], False)]:
                    cursor.execute(
                        "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, libelle, debit, credit, projet_id, sequence, created_at) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP)",
                        (journal_id, acct_id, code, f"Liberation - {nf}", montant if is_debit else 0, 0 if is_debit else montant, row.get("project_id"), 1 if is_debit else 2))
                cursor.execute("UPDATE retenues_chantier SET journal_entry_liberation_id = %s WHERE id = %s", (journal_id, holdback_id))
        except Exception as e:
            logger.warning("Release journal failed: %s", e)
        return {"id": holdback_id, "statut": "LIBEREE", "montant": montant, "journal_entry_id": journal_id, "message": "Retenue liberee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("release_holdback error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.get("/holdbacks/upcoming")
async def list_upcoming_holdbacks(user: ErpUser = Depends(get_current_user), days: int = Query(35)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_retenues_table(cursor)
        cursor.execute(
            "SELECT r.id, r.facture_id, f.numero_facture, f.client_nom, r.montant_retenu, r.date_fin_travaux "
            "FROM retenues_chantier r LEFT JOIN factures f ON f.id = r.facture_id "
            "WHERE r.statut = 'RETENUE' AND r.date_fin_travaux IS NOT NULL "
            "AND r.date_fin_travaux + (%s || ' days')::INTERVAL <= CURRENT_DATE ORDER BY r.date_fin_travaux",
            (str(days),))
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("date_fin_travaux"): d["date_fin_travaux"] = str(d["date_fin_travaux"])
            if d.get("montant_retenu") is not None: d["montant_retenu"] = float(d["montant_retenu"])
            items.append(d)
        return {"items": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("upcoming_holdbacks error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


# ============================================================
# IMMOBILISATIONS / AMORTISSEMENT (Fixed Assets)
# ============================================================

class FixedAssetCreate(BaseModel):
    nom: str
    description: Optional[str] = None
    categorie: str = "EQUIPEMENT"
    numero_serie: Optional[str] = None
    date_acquisition: Optional[str] = None
    cout_acquisition: float = Field(..., gt=0)
    duree_vie_mois: int = Field(60, gt=0)
    methode_amortissement: str = "LINEAIRE"
    taux_degressif: Optional[float] = None
    valeur_residuelle: float = Field(0, ge=0)
    compte_actif_code: str = "1500"
    compte_amort_code: str = "1510"
    notes: Optional[str] = None

    @field_validator("date_acquisition", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


def _ensure_immobilisations_table(cursor):
    cursor.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_name = 'immobilisations' AND table_schema = current_schema()"
    )
    if not cursor.fetchone():
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS immobilisations (
                    id SERIAL PRIMARY KEY, nom VARCHAR(200) NOT NULL, description TEXT,
                    categorie VARCHAR(50) DEFAULT 'EQUIPEMENT', numero_serie VARCHAR(100),
                    date_acquisition DATE NOT NULL, cout_acquisition NUMERIC(14,2) NOT NULL,
                    duree_vie_mois INTEGER NOT NULL DEFAULT 60,
                    methode_amortissement VARCHAR(20) DEFAULT 'LINEAIRE',
                    taux_degressif NUMERIC(5,2), valeur_residuelle NUMERIC(14,2) DEFAULT 0,
                    compte_actif_code VARCHAR(10) DEFAULT '1500', compte_amort_code VARCHAR(10) DEFAULT '1510',
                    statut VARCHAR(20) DEFAULT 'ACTIF', date_cession DATE, valeur_cession NUMERIC(14,2),
                    notes TEXT, created_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
            """)
        except Exception as exc:
            logger.warning("_ensure immobilisations: %s", exc)
            pass
    cursor.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_name = 'amortissement_ecritures' AND table_schema = current_schema()"
    )
    if not cursor.fetchone():
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS amortissement_ecritures (
                    id SERIAL PRIMARY KEY, immobilisation_id INTEGER NOT NULL,
                    journal_entry_id INTEGER, periode_mois VARCHAR(7) NOT NULL,
                    montant NUMERIC(14,2) NOT NULL, valeur_nette_comptable NUMERIC(14,2),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(immobilisation_id, periode_mois))
            """)
        except Exception as exc:
            logger.warning("_ensure amortissement_ecritures: %s", exc)
            pass


def _calc_depreciation(asset: dict, target_month: str = None) -> list:
    cout = float(asset["cout_acquisition"])
    res = float(asset.get("valeur_residuelle") or 0)
    duree = int(asset["duree_vie_mois"])
    methode = asset.get("methode_amortissement", "LINEAIRE")
    da = str(asset["date_acquisition"])[:10]
    y, m = int(da[:4]), int(da[5:7])
    schedule, vn = [], cout
    for i in range(duree):
        m += 1
        if m > 12: m, y = 1, y + 1
        ms = f"{y:04d}-{m:02d}"
        if methode == "DEGRESSIF" and asset.get("taux_degressif"):
            amt = round(vn * (float(asset["taux_degressif"]) / 100) / 12, 2)
        else:
            amt = round((cout - res) / duree, 2)
        amt = min(amt, round(vn - res, 2))
        if amt <= 0: break
        vn = round(vn - amt, 2)
        schedule.append({"periode": ms, "montant": amt, "amort_cumule": round(cout - vn, 2), "valeur_nette": vn})
        if target_month and ms == target_month: return schedule[-1:]
    return schedule


@router.get("/fixed-assets")
async def list_fixed_assets(user: ErpUser = Depends(get_current_user), page: int = Query(1, ge=1),
                            per_page: int = Query(20, ge=1, le=100), categorie: Optional[str] = None):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immobilisations_table(cursor)
        wheres, params = ["statut = 'ACTIF'"], []
        if categorie: wheres.append("categorie = %s"); params.append(categorie)
        w = " AND ".join(wheres)
        cursor.execute(f"SELECT COUNT(*) as total FROM immobilisations WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(f"SELECT * FROM immobilisations WHERE {w} ORDER BY date_acquisition DESC LIMIT %s OFFSET %s", params + [per_page, offset])
        items = []
        today_str = str(date.today())[:7]
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_acquisition", "date_cession", "created_at", "updated_at"):
                if d.get(k): d[k] = str(d[k])
            for k in ("cout_acquisition", "valeur_residuelle", "valeur_cession", "taux_degressif"):
                if d.get(k) is not None: d[k] = float(d[k])
            sched = _calc_depreciation(row)
            ac = 0
            for s in sched:
                if s["periode"] <= today_str: ac = s["amort_cumule"]
            d["amort_cumule"] = ac
            d["valeur_nette"] = round(float(d["cout_acquisition"]) - ac, 2)
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_fixed_assets error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.post("/fixed-assets")
async def create_fixed_asset(body: FixedAssetCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if not body.date_acquisition:
        raise HTTPException(status_code=422, detail="date_acquisition est obligatoire")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immobilisations_table(cursor)
        cursor.execute(
            "INSERT INTO immobilisations (nom, description, categorie, numero_serie, date_acquisition, cout_acquisition, "
            "duree_vie_mois, methode_amortissement, taux_degressif, valeur_residuelle, compte_actif_code, compte_amort_code, "
            "notes, created_by, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP) RETURNING id",
            (body.nom, body.description, body.categorie, body.numero_serie, body.date_acquisition, body.cout_acquisition,
             body.duree_vie_mois, body.methode_amortissement, body.taux_degressif, body.valeur_residuelle,
             body.compte_actif_code, body.compte_amort_code, body.notes, str(user.user_id)))
        return {"id": cursor.fetchone()["id"], "message": "Immobilisation creee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_fixed_asset error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.get("/fixed-assets/summary")
async def get_fixed_assets_summary(user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immobilisations_table(cursor)
        cursor.execute("SELECT * FROM immobilisations WHERE statut = 'ACTIF'")
        assets = [dict(r) for r in cursor.fetchall()]
        total_cout = sum(float(a["cout_acquisition"]) for a in assets)
        today_str = str(date.today())[:7]
        total_amort = 0
        for a in assets:
            asset_amort = 0
            for s in _calc_depreciation(a):
                if s["periode"] <= today_str: asset_amort = s["amort_cumule"]
            total_amort += asset_amort
        return {"nombre_actifs": len(assets), "total_cout": round(total_cout, 2),
                "total_amort_cumule": round(total_amort, 2), "valeur_nette_total": round(total_cout - total_amort, 2)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("fixed_assets_summary error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.get("/fixed-assets/{asset_id}/schedule")
async def get_depreciation_schedule(asset_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immobilisations_table(cursor)
        cursor.execute("SELECT * FROM immobilisations WHERE id = %s", (asset_id,))
        row = cursor.fetchone()
        if not row: raise HTTPException(status_code=404, detail="Immobilisation non trouvee")
        return {"asset_id": asset_id, "schedule": _calc_depreciation(dict(row))}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("depreciation_schedule error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


@router.post("/fixed-assets/generate-depreciation")
async def generate_depreciation(user: ErpUser = Depends(get_current_user), mois: str = Query(...)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    # Normalize mois to YYYY-MM format (handle "2026-4" -> "2026-04")
    try:
        parts = mois.split("-")
        mois = f"{int(parts[0]):04d}-{int(parts[1]):02d}"
    except (IndexError, ValueError):
        raise HTTPException(status_code=400, detail="Format mois invalide (YYYY-MM)")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_immobilisations_table(cursor)
        cursor.execute("SELECT * FROM immobilisations WHERE statut = 'ACTIF' AND date_acquisition < (%s || '-01')::date", (mois,))
        assets = [dict(r) for r in cursor.fetchall()]
        if not assets: return {"message": "Aucune immobilisation active", "entries_created": 0}
        cursor.execute("SELECT id FROM plan_comptable WHERE code = '6800' AND actif = TRUE")
        r6800 = cursor.fetchone()
        cursor.execute("SELECT id FROM plan_comptable WHERE code = '1510' AND actif = TRUE")
        r1510 = cursor.fetchone()
        if not r6800 or not r1510: raise HTTPException(status_code=400, detail="Comptes 6800/1510 requis")
        total_amort, lines = 0, []
        for a in assets:
            cursor.execute("SELECT id FROM amortissement_ecritures WHERE immobilisation_id = %s AND periode_mois = %s", (a["id"], mois))
            if cursor.fetchone(): continue
            dep = _calc_depreciation(a, target_month=mois)
            if not dep: continue
            total_amort += dep[0]["montant"]
            lines.append({"asset_id": a["id"], "nom": a["nom"], "montant": dep[0]["montant"], "vnc": dep[0]["valeur_nette"]})
        if not lines: return {"message": f"Amortissement deja genere pour {mois}", "entries_created": 0}
        cursor.execute(
            "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, libelle, type_journal, source_type, montant_total, statut, validated_at, created_at) "
            "VALUES ('TEMP', (%s||'-01')::date, (%s||'-01')::date, %s, 'AMORTISSEMENT', 'immobilisation', %s, 'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
            (mois, mois, f"Amortissement {mois} ({len(lines)} actifs)", round(total_amort, 2)))
        eid = cursor.fetchone()["id"]
        cursor.execute("UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s", (f"JE-AMO-{eid:05d}", eid))
        seq = 0
        for ln in lines:
            seq += 1
            cursor.execute("INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, libelle, debit, credit, sequence, created_at) VALUES (%s,%s,'6800',%s,%s,0,%s,CURRENT_TIMESTAMP)",
                           (eid, r6800["id"], f"Amort. {ln['nom']}", ln["montant"], seq))
        seq += 1
        cursor.execute("INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, libelle, debit, credit, sequence, created_at) VALUES (%s,%s,'1510',%s,0,%s,%s,CURRENT_TIMESTAMP)",
                       (eid, r1510["id"], f"Amort. cumule {mois}", round(total_amort, 2), seq))
        for ln in lines:
            cursor.execute("INSERT INTO amortissement_ecritures (immobilisation_id, journal_entry_id, periode_mois, montant, valeur_nette_comptable) VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                           (ln["asset_id"], eid, mois, ln["montant"], ln["vnc"]))
        return {"message": f"Amortissement {mois}: {len(lines)} actifs, {round(total_amort,2)}$", "journal_entry_id": eid, "entries_created": len(lines)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("generate_depreciation error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        try: db.reset_tenant(conn)
        except Exception: pass
        conn.close()


# ============================================
# PAYROLL SYNC: Python-only journal entries from payroll_runs
# ============================================
# Le trigger PG trg_payroll_run_journal a ete supprime par la migration
# 20260307_0001 (Phase 3) avec l'intention de basculer en Python-only.
# Ces helpers + endpoint comblent le gap: les payroll_runs APPROUVE/PAYE
# n'avaient plus aucune ecriture comptable generee.

def _ensure_payroll_sync_columns(cursor):
    """Ensure journal_entry_id column exists on payroll_runs table.

    Sert de marqueur d'idempotence (cf. patron _ensure_sync_columns pour
    factures/bons_commande).

    SAVEPOINT-protected via _safe_ddl: appele depuis sync_all_accounting et
    sync_payroll_entries qui sont en mode transactionnel. Sans cette
    protection, un ALTER en echec poisonnerait la tx parente (tx-aborted).
    """
    _safe_ddl(
        cursor,
        "ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS journal_entry_id INTEGER",
        "sp_payroll_sync_col",
        "_ensure_payroll_sync_columns payroll_runs",
    )


def _create_payroll_journal_entry(cursor, payroll_run_id, user=None):
    """Create a PAIE journal entry for a single payroll_run (statut APPROUVE/PAYE).

    Reproduit en Python la logique du trigger PG trg_payroll_run_journal
    supprime par la migration 20260307_0001.

    Debit  6100 (Salaires administration) = total_brut (par defaut, faute de
           distinction admin/chantier directe sur payroll_runs)
    Credit 2300 (Salaires a payer)        = total_net
    Credit 2310 (Retenues a la source)    = total_deductions (impots/RRQ/AE/RQAP)
    Credit 2320 (CNESST a payer)          = total_charges_employeur (si colonne)

    Si journal_entry_id deja set sur le payroll_run, retourne l'ID existant
    (idempotent). Si 6100 ou 2300 absents du plan_comptable, log warning + None.
    Si 2310/2320 absents, on degrade en n'inserant que les lignes possibles.

    Returns the journal_entry_id or None if skipped.
    """
    # Detection defensive de la colonne charges employeur (varie selon tenant)
    has_charges_col = True
    try:
        cursor.execute(
            "SELECT id, statut, total_brut, total_net, total_deductions, "
            "total_charges_employeur, date_traitement, journal_entry_id "
            "FROM payroll_runs WHERE id = %s",
            (payroll_run_id,),
        )
        pr = cursor.fetchone()
    except Exception:
        has_charges_col = False
        cursor.execute(
            "SELECT id, statut, total_brut, total_net, total_deductions, "
            "date_traitement, journal_entry_id "
            "FROM payroll_runs WHERE id = %s",
            (payroll_run_id,),
        )
        pr = cursor.fetchone()

    if not pr:
        return None
    pr = dict(pr)

    # Idempotent: si deja lie, retour direct
    if pr.get("journal_entry_id"):
        return pr["journal_entry_id"]

    total_brut = float(pr.get("total_brut") or 0)
    total_net = float(pr.get("total_net") or 0)
    total_ded = float(pr.get("total_deductions") or 0)
    total_charges = float(pr.get("total_charges_employeur") or 0) if has_charges_col else 0.0

    if total_brut == 0 and total_net == 0:
        return None

    # Lookup comptes plan_comptable (codes 6100/2300/2310/2320)
    account_map = {}
    for code in ('6100', '2300', '2310', '2320'):
        cursor.execute("SELECT id FROM plan_comptable WHERE code = %s AND actif = TRUE", (code,))
        row = cursor.fetchone()
        account_map[code] = row["id"] if row else None

    if not account_map.get('6100') or not account_map.get('2300'):
        logger.warning(
            "Comptes 6100/2300 absents du plan comptable, ecriture paie %s ignoree",
            payroll_run_id,
        )
        return None

    # Verification d'equilibre comptable AVANT INSERT.
    # Identite paie: total_brut = total_net + total_deductions (cf. payroll.py).
    # Ecriture canonique:
    #   DEBIT  6100 = total_brut + total_charges_employeur (salaires + charges sociales patronales)
    #   CREDIT 2300 = total_net
    #   CREDIT 2310 = total_deductions
    #   CREDIT 2320 = total_charges_employeur
    # => Sum debit = brut + charges = (net + ded) + charges = sum credit. Equilibre OK.
    # Si 2310 absent du plan, total_deductions est fusionne dans 2300 pour conserver l'equilibre.
    # Si 2320 absent, on degrade total_charges_employeur a 0 (charges patronales non comptabilisees,
    # un compte 2320 doit etre ajoute au plan_comptable du tenant pour les firmes avec employes).

    if not account_map.get('2320') and total_charges > 0:
        logger.warning(
            "Compte 2320 (CNESST/charges) absent — paie %s: charges employeur %.2f$ "
            "non comptabilisees. Ajoutez 2320 au plan comptable.",
            payroll_run_id, total_charges,
        )
        total_charges = 0.0  # degrade pour preserver l'equilibre

    debit_total = total_brut + total_charges
    credit_2300 = total_net
    credit_2310 = total_ded if account_map.get('2310') else 0.0
    credit_other = total_ded if not account_map.get('2310') else 0.0  # fusion dans 2300 si 2310 absent
    credit_2300_effective = credit_2300 + credit_other
    credit_2320 = total_charges
    credit_total = credit_2300_effective + credit_2310 + credit_2320

    if abs(debit_total - credit_total) > 0.01:
        logger.error(
            "Paie %s: ecriture desequilibree (debit=%.2f, credit=%.2f). "
            "Donnees payroll_run incoherentes ou plan comptable incomplet.",
            payroll_run_id, debit_total, credit_total,
        )
        return None

    date_ecriture = pr.get("date_traitement") or str(date.today())

    # INSERT journal_entries RETURNING id
    cursor.execute(
        "INSERT INTO journal_entries (numero_ecriture, date_ecriture, date_comptable, "
        "libelle, type_journal, source_type, source_id, montant_total, "
        "statut, validated_at, created_at) "
        "VALUES ('TEMP', %s, %s, %s, 'PAIE', 'payroll_run', %s, %s, "
        "'VALIDEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id",
        (str(date_ecriture), str(date_ecriture),
         f"Paie - Execution #{payroll_run_id}",
         payroll_run_id, debit_total),
    )
    entry_id = cursor.fetchone()["id"]
    cursor.execute("UPDATE journal_entries SET numero_ecriture = %s WHERE id = %s",
                   (f"JE-PAI-{entry_id:05d}", entry_id))

    seq = 1
    # Line 1: Debit Salaires + charges sociales (6100) = total_brut + total_charges
    cursor.execute(
        "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
        "libelle, debit, credit, sequence, created_at) "
        "VALUES (%s, %s, '6100', %s, %s, 0, %s, CURRENT_TIMESTAMP)",
        (entry_id, account_map['6100'],
         f"Salaires bruts + charges patronales - Paie #{payroll_run_id}",
         debit_total, seq))
    seq += 1

    # Line 2: Credit Salaires a payer (2300) — net + (deductions si 2310 absent)
    if credit_2300_effective > 0:
        libelle_2300 = (
            f"Salaires nets a payer - Paie #{payroll_run_id}"
            if account_map.get('2310')
            else f"Salaires nets + retenues - Paie #{payroll_run_id} (2310 absent)"
        )
        cursor.execute(
            "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
            "libelle, debit, credit, sequence, created_at) "
            "VALUES (%s, %s, '2300', %s, 0, %s, %s, CURRENT_TIMESTAMP)",
            (entry_id, account_map['2300'], libelle_2300, credit_2300_effective, seq))
        seq += 1

    # Line 3: Credit Retenues a la source (2310) = total_deductions (si compte present)
    if credit_2310 > 0:
        cursor.execute(
            "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
            "libelle, debit, credit, sequence, created_at) "
            "VALUES (%s, %s, '2310', %s, 0, %s, %s, CURRENT_TIMESTAMP)",
            (entry_id, account_map['2310'],
             f"Retenues a la source - Paie #{payroll_run_id}", credit_2310, seq))
        seq += 1

    # Line 4: Credit CNESST/charges employeur (2320) = total_charges_employeur
    if credit_2320 > 0:
        cursor.execute(
            "INSERT INTO journal_lines (journal_entry_id, compte_id, compte_code, "
            "libelle, debit, credit, sequence, created_at) "
            "VALUES (%s, %s, '2320', %s, 0, %s, %s, CURRENT_TIMESTAMP)",
            (entry_id, account_map['2320'],
             f"CNESST/charges employeur - Paie #{payroll_run_id}", credit_2320, seq))
        seq += 1

    # Link journal entry back to payroll_run
    try:
        cursor.execute(
            "UPDATE payroll_runs SET journal_entry_id = %s WHERE id = %s",
            (entry_id, payroll_run_id),
        )
    except Exception as exc:
        logger.warning("UPDATE payroll_runs.journal_entry_id failed for %s: %s",
                       payroll_run_id, exc)

    # Audit trail (best-effort — n'echoue jamais l'action)
    _log_accounting_action(
        cursor, user, "create", "journal_entry", entry_id,
        details={
            "type_journal": "PAIE",
            "source_type": "payroll_run",
            "source_id": payroll_run_id,
            "montant_total": debit_total,
            "total_brut": total_brut,
            "total_net": total_net,
            "total_deductions": total_ded,
            "total_charges_employeur": total_charges,
        },
    )

    return entry_id


@router.post("/payroll-entries/sync")
async def sync_payroll_entries(user: ErpUser = Depends(get_current_user)):
    """Sync les payroll_runs (statut APPROUVE/PAYE) sans ecriture comptable.

    Cree retroactivement une ecriture journal PAIE pour chaque payroll_run
    en statut APPROUVE ou PAYE qui n'a pas encore de journal_entry_id.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        # Mode transactionnel: SELECT FOR UPDATE SKIP LOCKED ne tient le lock
        # qu'en transaction explicite. Sans cela, deux syncs concurrentes
        # peuvent creer chacune une ecriture pour le meme payroll_run.
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        _ensure_payroll_sync_columns(cursor)

        cursor.execute(
            "SELECT id FROM payroll_runs "
            "WHERE UPPER(statut) IN ('APPROUVE', 'PAYE') "
            "AND journal_entry_id IS NULL "
            "ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED"
        )
        run_ids = [row["id"] for row in cursor.fetchall()]

        synced = 0
        errors = []
        for rid in run_ids:
            # SAVEPOINT par run pour atomicite par item: si la creation
            # d'une ecriture crash en plein milieu (entete OK mais lignes
            # plantees), on rollback uniquement ce run et on continue.
            _savepoint_create(cursor, "sp_item")
            try:
                entry_id = _create_payroll_journal_entry(cursor, rid, user=user)
                if entry_id:
                    synced += 1
                _savepoint_release(cursor, "sp_item")
            except Exception as exc:
                _savepoint_rollback(cursor, "sp_item")
                logger.warning("sync_payroll_entries payroll_run %s failed: %s", rid, exc)
                errors.append({"payroll_run_id": rid, "error": str(exc)})

        conn.commit()
        return {
            "message": f"Sync paie: {synced} ecriture(s) creee(s) sur {len(run_ids)} candidat(s)",
            "payroll_synced": synced,
            "errors": errors,
        }
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("sync_payroll_entries error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la synchronisation paie")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        _end_tx(conn, tx_modified)
        conn.close()


@router.get("/orphans")
async def list_orphan_entries(user: ErpUser = Depends(get_current_user)):
    """Detecte les ecritures orphelines/incoherentes pour cleanup admin.

    Returns:
      - entries_no_lines: ecritures sans aucune ligne
      - entries_unbalanced: ecritures avec sum(debit) != sum(credit)
      - entries_orphan_source: ecritures dont source_id pointe sur une facture/
        payroll_run supprime
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        # Query 1: ecritures sans aucune ligne associee (LEFT JOIN + IS NULL).
        # Symptome typique d'un crash mid-sync entre INSERT je et INSERT jl.
        cursor.execute(
            "SELECT je.id, je.numero_ecriture, je.libelle, je.source_type, je.source_id "
            "FROM journal_entries je "
            "LEFT JOIN journal_lines jl ON jl.journal_entry_id = je.id "
            "WHERE jl.id IS NULL "
            "GROUP BY je.id, je.numero_ecriture, je.libelle, je.source_type, je.source_id "
            "ORDER BY je.id DESC LIMIT 100"
        )
        entries_no_lines = []
        for row in cursor.fetchall():
            entries_no_lines.append({
                "id": row["id"],
                "numero_ecriture": row.get("numero_ecriture"),
                "libelle": row.get("libelle"),
                "source_type": row.get("source_type"),
                "source_id": row.get("source_id"),
            })

        # Query 2: ecritures desequilibrees (sum debit != sum credit, > 1 cent).
        # En partie double, toute ecriture validee doit avoir debit == credit.
        cursor.execute(
            "SELECT je.id, je.numero_ecriture, je.libelle, je.source_type, je.source_id, "
            "SUM(jl.debit) as total_debit, SUM(jl.credit) as total_credit "
            "FROM journal_entries je "
            "JOIN journal_lines jl ON jl.journal_entry_id = je.id "
            "GROUP BY je.id, je.numero_ecriture, je.libelle, je.source_type, je.source_id "
            "HAVING ABS(COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)) > 0.01 "
            "ORDER BY je.id DESC LIMIT 100"
        )
        entries_unbalanced = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("total_debit", "total_credit"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            entries_unbalanced.append({
                "id": d["id"],
                "numero_ecriture": d.get("numero_ecriture"),
                "libelle": d.get("libelle"),
                "source_type": d.get("source_type"),
                "source_id": d.get("source_id"),
                "total_debit": d.get("total_debit"),
                "total_credit": d.get("total_credit"),
            })

        # Query 3: ecritures dont la facture source n'existe plus.
        # Couverture limitee a source_type='facture' (les autres types — paie,
        # depense, paiement_facture — varient selon les tenants et necessitent
        # une logique au cas par cas qui depasse ce endpoint de detection).
        entries_orphan_source = []
        try:
            cursor.execute(
                "SELECT je.id, je.numero_ecriture, je.libelle, je.source_type, je.source_id "
                "FROM journal_entries je "
                "WHERE je.source_type = 'facture' AND je.source_id IS NOT NULL "
                "AND NOT EXISTS (SELECT 1 FROM factures f WHERE f.id = je.source_id) "
                "ORDER BY je.id DESC LIMIT 100"
            )
            for row in cursor.fetchall():
                entries_orphan_source.append({
                    "id": row["id"],
                    "numero_ecriture": row.get("numero_ecriture"),
                    "libelle": row.get("libelle"),
                    "source_type": row.get("source_type"),
                    "source_id": row.get("source_id"),
                })
        except Exception as exc:
            # Table factures absente sur ce tenant (tenant minimal) — on logge
            # un warning et on retourne une liste vide plutot que de casser
            # tout le endpoint.
            logger.warning("list_orphan_entries orphan_source query: %s", exc)

        total_count = (
            len(entries_no_lines) + len(entries_unbalanced) + len(entries_orphan_source)
        )
        return {
            "entries_no_lines": entries_no_lines,
            "entries_unbalanced": entries_unbalanced,
            "entries_orphan_source": entries_orphan_source,
            "total_count": total_count,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_orphan_entries error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la detection des ecritures orphelines")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/orphans/{entry_id}/cleanup")
async def cleanup_orphan_entry(entry_id: int, user: ErpUser = Depends(get_current_user)):
    """Supprime une ecriture orpheline (sans lignes ou desequilibree).

    SECURITE:
    - Reserve aux roles admin/super_admin/comptable (les autres = 403)
    - Refus si l'ecriture a des lignes equilibrees (= ecriture valide)
    - Unlink prealable des sources (factures.journal_entry_id, etc.)
    - Audit log obligatoire
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    # Check role: cleanup d'ecritures = action admin sensible
    user_role = (getattr(user, "role", "") or "").lower()
    if user_role not in ("admin", "super_admin", "comptable", "accountant"):
        raise HTTPException(
            status_code=403,
            detail="Action reservee aux administrateurs/comptables.",
        )
    conn = db.get_conn()
    cursor = None
    tx_modified = False
    try:
        # Mode transactionnel explicite: SELECT FOR UPDATE doit tenir le lock
        # entre statements pour serialiser les cleanup concurrents.
        tx_modified = _begin_tx(conn)
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT id, numero_ecriture, libelle, source_type, source_id, statut "
            "FROM journal_entries WHERE id = %s FOR UPDATE",
            (entry_id,),
        )
        entry = cursor.fetchone()
        if not entry:
            raise HTTPException(status_code=404, detail="Ecriture non trouvee")

        # Comptage des lignes + verification de l'equilibre debit/credit.
        cursor.execute(
            "SELECT COUNT(*) as nb, COALESCE(SUM(debit), 0) as total_debit, "
            "COALESCE(SUM(credit), 0) as total_credit "
            "FROM journal_lines WHERE journal_entry_id = %s",
            (entry_id,),
        )
        agg = cursor.fetchone()
        nb_lines = int(agg["nb"]) if agg and agg.get("nb") is not None else 0
        total_debit = float(agg["total_debit"]) if agg and agg.get("total_debit") is not None else 0.0
        total_credit = float(agg["total_credit"]) if agg and agg.get("total_credit") is not None else 0.0
        balanced = abs(total_debit - total_credit) <= 0.01

        # SECURITE: refus de supprimer une ecriture valide (lignes presentes
        # ET equilibrees). Seules les ecritures sans lignes ou desequilibrees
        # sont eligibles au cleanup orphan.
        if nb_lines > 0 and balanced:
            raise HTTPException(
                status_code=400,
                detail="Ecriture valide, refus de suppression",
            )

        # Unlink des sources qui referencent encore cette ecriture.
        # Sans ce nettoyage, factures/bons_commande/payroll_runs garderaient
        # un journal_entry_id pointant sur une ligne supprimee — ce qui
        # masquerait l'ecriture aux syncs futures (filtre IS NULL).
        # SAVEPOINT-protected: tables peuvent ne pas exister sur tenant minimal.
        for unlink_table in ("factures", "bons_commande", "payroll_runs"):
            _safe_ddl(
                cursor,
                f"UPDATE {unlink_table} SET journal_entry_id = NULL "
                f"WHERE journal_entry_id = {entry_id}",
                f"sp_unlink_{unlink_table}",
                f"cleanup_orphan unlink {unlink_table}",
            )

        # Suppression: lignes d'abord (FK), puis l'entete.
        cursor.execute("DELETE FROM journal_lines WHERE journal_entry_id = %s", (entry_id,))
        cursor.execute("DELETE FROM journal_entries WHERE id = %s", (entry_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Ecriture non trouvee")

        # Audit trail dans la meme transaction.
        _log_accounting_action(
            cursor, user, "cleanup_orphan", "journal_entry", entry_id,
            details={
                "numero_ecriture": entry.get("numero_ecriture"),
                "libelle": entry.get("libelle"),
                "source_type": entry.get("source_type"),
                "source_id": entry.get("source_id"),
                "nb_lines_deleted": nb_lines,
                "total_debit": total_debit,
                "total_credit": total_credit,
                "balanced": balanced,
            },
        )
        conn.commit()

        return {
            "message": "Ecriture orpheline supprimee",
            "id": entry_id,
            "nb_lines_deleted": nb_lines,
            "balanced": balanced,
        }
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("cleanup_orphan_entry error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression de l'ecriture orpheline")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        _end_tx(conn, tx_modified)
        conn.close()
