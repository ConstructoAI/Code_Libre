"""
ERP React - Companies & Contacts Router
CRUD for companies (clients/fournisseurs) and contacts.
Based on app.py show_companies_page (~2,000 lines) + crm.py.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from typing import Optional

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

logger = logging.getLogger(__name__)


def _strip_non_empty(v):
    """Strip whitespace and reject empty strings. Passes None through.

    Used by required-name field_validators to block `""` and `"   "` inputs
    that would otherwise create invisible/unsearchable records in the BD.
    """
    if v is None:
        return v
    v = str(v).strip()
    if not v:
        raise ValueError("Ne peut pas etre vide")
    return v
router = APIRouter(tags=["Companies & Contacts"])

_address_cols_ensured: set = set()   # tracks schemas already migrated this process


def _ensure_contact_address_cols(conn, schema: str):
    """Lazy-add address columns to contacts table (idempotent, once per schema per process).

    Uses autocommit so DDL is persisted immediately and does not depend on
    a later conn.commit() that read-only endpoints never issue.
    """
    if schema in _address_cols_ensured:
        return
    prev_autocommit = conn.autocommit
    try:
        conn.autocommit = True
        cur = conn.cursor()
        for col, ctype in [("adresse", "TEXT"), ("ville", "VARCHAR(100)"),
                            ("province", "VARCHAR(50)"), ("code_postal", "VARCHAR(20)")]:
            try:
                cur.execute(f"ALTER TABLE contacts ADD COLUMN IF NOT EXISTS {col} {ctype}")
            except Exception:
                pass
        cur.close()
        _address_cols_ensured.add(schema)
    except Exception:
        pass          # don't cache on failure so it retries next request
    finally:
        conn.autocommit = prev_autocommit


# ============================================
# PYDANTIC MODELS
# ============================================

class CompanyCreate(BaseModel):
    nom: str
    type_company: str = "Entrepreneur général"
    secteur_activite: Optional[str] = None
    email: Optional[str] = None
    telephone: Optional[str] = None
    adresse: Optional[str] = None
    ville: Optional[str] = None
    province: Optional[str] = "Québec"
    code_postal: Optional[str] = None
    pays: Optional[str] = "Canada"
    site_web: Optional[str] = None
    contact_principal_id: Optional[int] = None
    numero_tps: Optional[str] = None
    numero_tvq: Optional[str] = None
    payment_terms: str = "Net 30"
    notes: Optional[str] = None

    _nom_validator = field_validator("nom", mode="before")(_strip_non_empty)


class CompanyUpdate(BaseModel):
    nom: Optional[str] = None
    type_company: Optional[str] = None
    secteur_activite: Optional[str] = None
    email: Optional[str] = None
    telephone: Optional[str] = None
    adresse: Optional[str] = None
    ville: Optional[str] = None
    province: Optional[str] = None
    code_postal: Optional[str] = None
    pays: Optional[str] = None
    site_web: Optional[str] = None
    contact_principal_id: Optional[int] = None
    numero_tps: Optional[str] = None
    numero_tvq: Optional[str] = None
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    statut: Optional[str] = None

    _nom_validator = field_validator("nom", mode="before")(_strip_non_empty)


class ContactCreate(BaseModel):
    company_id: Optional[int] = None
    prenom: str
    nom_famille: str
    email: Optional[str] = None
    telephone: Optional[str] = None
    mobile: Optional[str] = None
    role_poste: Optional[str] = None
    fonction: Optional[str] = None
    departement: Optional[str] = None
    adresse: Optional[str] = None
    ville: Optional[str] = None
    province: Optional[str] = None
    code_postal: Optional[str] = None
    est_principal: bool = False
    notes: Optional[str] = None

    _prenom_validator = field_validator("prenom", mode="before")(_strip_non_empty)
    _nom_famille_validator = field_validator("nom_famille", mode="before")(_strip_non_empty)


class ContactUpdate(BaseModel):
    company_id: Optional[int] = None
    prenom: Optional[str] = None
    nom_famille: Optional[str] = None
    email: Optional[str] = None
    telephone: Optional[str] = None
    mobile: Optional[str] = None
    role_poste: Optional[str] = None
    fonction: Optional[str] = None
    departement: Optional[str] = None
    adresse: Optional[str] = None
    ville: Optional[str] = None
    province: Optional[str] = None
    code_postal: Optional[str] = None
    est_principal: Optional[bool] = None
    notes: Optional[str] = None

    _prenom_validator = field_validator("prenom", mode="before")(_strip_non_empty)
    _nom_famille_validator = field_validator("nom_famille", mode="before")(_strip_non_empty)


# ============================================
# COMPANIES ENDPOINTS
# ============================================

@router.get("/companies")
async def list_companies(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    limit: Optional[int] = Query(None, ge=1, le=100, description="Alias for per_page"),
    search: Optional[str] = None,
    type_filter: Optional[str] = None,
):
    """List companies with pagination, search, and type filter."""
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

        where_clauses = []
        params = []

        if search:
            where_clauses.append(
                "(LOWER(nom) LIKE %s OR LOWER(email) LIKE %s OR LOWER(ville) LIKE %s)"
            )
            s = f"%{search.lower()}%"
            params.extend([s, s, s])

        if type_filter:
            where_clauses.append("type_company = %s")
            params.append(type_filter)

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        # Count
        cursor.execute(f"SELECT COUNT(*) as total FROM companies WHERE {where_sql}", params)
        total = cursor.fetchone()["total"]

        # Fetch page
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT * "
            f"FROM companies WHERE {where_sql} "
            f"ORDER BY nom ASC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = [dict(row) for row in cursor.fetchall()]

        # Stringify dates
        for item in items:
            for k in ("created_at", "updated_at"):
                if item.get(k):
                    item[k] = str(item[k])

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_companies error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la recuperation")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/companies/{company_id}")
async def get_company(company_id: int, user: ErpUser = Depends(get_current_user)):
    """Get a single company by ID with its contacts."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "SELECT * FROM companies WHERE id = %s", (company_id,)
        )
        company = cursor.fetchone()
        if not company:
            raise HTTPException(status_code=404, detail="Entreprise non trouvée")

        result = dict(company)
        for k in ("created_at", "updated_at"):
            if result.get(k):
                result[k] = str(result[k])

        # Get contacts
        _ensure_contact_address_cols(conn, user.schema)
        cursor.execute(
            "SELECT id, prenom, nom_famille, email, telephone, mobile, role_poste, fonction, departement, "
            "adresse, ville, province, code_postal, est_principal, notes, "
            "created_at FROM contacts WHERE company_id = %s ORDER BY est_principal DESC, nom_famille ASC",
            (company_id,),
        )
        contacts = []
        for c in cursor.fetchall():
            cd = dict(c)
            if cd.get("created_at"):
                cd["created_at"] = str(cd["created_at"])
            contacts.append(cd)

        result["contacts"] = contacts
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_company error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/companies")
async def create_company(body: CompanyCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new company."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        cursor.execute(
            "INSERT INTO companies (nom, type_company, secteur_activite, email, telephone, "
            "adresse, ville, province, code_postal, pays, site_web, contact_principal_id, "
            "numero_tps, numero_tvq, payment_terms, notes, created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
            "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.nom, body.type_company, body.secteur_activite,
             body.email, body.telephone, body.adresse,
             body.ville, body.province, body.code_postal, body.pays,
             body.site_web, body.contact_principal_id,
             body.numero_tps, body.numero_tvq, body.payment_terms, body.notes),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Entreprise créée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_company error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la création")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/companies/{company_id}")
async def update_company(
    company_id: int, body: CompanyUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update a company."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    ALLOWED_COLS = {"nom", "type_company", "secteur_activite", "email", "telephone",
                     "adresse", "ville", "province", "code_postal", "pays",
                     "site_web", "contact_principal_id",
                     "numero_tps", "numero_tvq", "payment_terms", "notes", "statut"}
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values()) + [company_id]

        cursor.execute(
            f"UPDATE companies SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        conn.commit()
        return {"message": "Entreprise mise à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_company error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la mise à jour")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/companies/{company_id}")
async def delete_company(company_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a company (soft delete by setting statut to Inactif)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE companies SET statut = 'Inactif', updated_at = CURRENT_TIMESTAMP "
            "WHERE id = %s", (company_id,),
        )
        conn.commit()
        return {"message": "Entreprise desactivee"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_company error: %s", exc)
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
# CONTACTS ENDPOINTS
# ============================================

@router.get("/contacts")
async def list_contacts(
    user: ErpUser = Depends(get_current_user),
    company_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
):
    """List contacts, optionally filtered by company."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_contact_address_cols(conn, user.schema)

        where_clauses = []
        params = []

        if company_id:
            where_clauses.append("c.company_id = %s")
            params.append(company_id)

        if search:
            where_clauses.append(
                "(LOWER(c.prenom || ' ' || c.nom_famille) LIKE %s OR LOWER(c.email) LIKE %s)"
            )
            s = f"%{search.lower()}%"
            params.extend([s, s])

        where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"

        cursor.execute(
            f"SELECT COUNT(*) as total FROM contacts c WHERE {where_sql}", params
        )
        total = cursor.fetchone()["total"]

        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT c.id, c.prenom, c.nom_famille, c.email, c.telephone, c.mobile, "
            f"c.role_poste, c.fonction, c.departement, "
            f"c.adresse, c.ville, c.province, c.code_postal, "
            f"c.est_principal, c.notes, c.company_id, c.created_at, "
            f"co.nom as company_nom "
            f"FROM contacts c "
            f"LEFT JOIN companies co ON c.company_id = co.id "
            f"WHERE {where_sql} "
            f"ORDER BY c.nom_famille ASC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            items.append(d)

        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_contacts error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/contacts")
async def create_contact(body: ContactCreate, user: ErpUser = Depends(get_current_user)):
    """Create a new contact."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    # Normaliser company_id: 0 ou negatif → None (NULL en BD)
    if body.company_id is not None and body.company_id <= 0:
        body.company_id = None

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()

        _ensure_contact_address_cols(conn, user.schema)

        cursor.execute(
            "INSERT INTO contacts (company_id, prenom, nom_famille, email, telephone, mobile, "
            "role_poste, fonction, departement, adresse, ville, province, code_postal, "
            "est_principal, notes, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP) RETURNING id",
            (body.company_id, body.prenom, body.nom_famille, body.email,
             body.telephone, body.mobile, body.role_poste, body.fonction,
             body.departement, body.adresse, body.ville, body.province, body.code_postal,
             body.est_principal, body.notes),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Contact créé"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_contact error: %s", exc)
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


@router.put("/contacts/{contact_id}")
async def update_contact(
    contact_id: int, body: ContactUpdate, user: ErpUser = Depends(get_current_user)
):
    """Update a contact."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    # Normaliser company_id: 0 ou negatif → None (NULL en BD)
    if body.company_id is not None and body.company_id <= 0:
        body.company_id = None

    ALLOWED_COLS = {"company_id", "prenom", "nom_famille", "email", "telephone", "mobile",
                     "role_poste", "fonction", "departement", "adresse", "ville", "province",
                     "code_postal", "est_principal", "notes"}
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_contact_address_cols(conn, user.schema)

        set_parts = [f"{k} = %s" for k in fields]
        values = list(fields.values()) + [contact_id]

        cursor.execute(
            f"UPDATE contacts SET {', '.join(set_parts)} WHERE id = %s", values,
        )
        conn.commit()
        return {"message": "Contact mis à jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_contact error: %s", exc)
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


@router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: int, user: ErpUser = Depends(get_current_user)):
    """Delete a contact."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")

    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM contacts WHERE id = %s", (contact_id,))
        conn.commit()
        return {"message": "Contact supprimé"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_contact error: %s", exc)
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
