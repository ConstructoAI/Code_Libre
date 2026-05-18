"""
ERP React - Suppliers Router
Fournisseurs + bons commande + évaluation.
Real DB columns: nom_fournisseur, contact_principal, categorie_produits,
evaluation_qualite, est_actif, company_id, conditions_paiement
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from typing import Optional

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/suppliers", tags=["Suppliers"])


def _empty_to_none(v):
    """Convert empty strings to None — used on date fields to avoid PostgreSQL
    'invalid input syntax for type date: ""' errors when frontend sends blank dates."""
    return None if isinstance(v, str) and v.strip() == "" else v


class SupplierCreate(BaseModel):
    company_id: int
    nom_fournisseur: Optional[str] = None
    code_fournisseur: Optional[str] = None
    contact_principal: Optional[str] = None
    email: Optional[str] = None
    telephone: Optional[str] = None
    adresse: Optional[str] = None
    ville: Optional[str] = None
    province: Optional[str] = "Québec"
    code_postal: Optional[str] = None
    categorie_produits: Optional[str] = None
    conditions_paiement: str = "30 jours net"
    delai_livraison_moyen: Optional[int] = 14
    contact_commercial: Optional[str] = None
    contact_technique: Optional[str] = None
    evaluation_qualite: Optional[int] = 5
    certifications: Optional[str] = None
    notes: Optional[str] = None
    notes_evaluation: Optional[str] = None


class SupplierUpdate(BaseModel):
    nom_fournisseur: Optional[str] = None
    contact_principal: Optional[str] = None
    email: Optional[str] = None
    telephone: Optional[str] = None
    adresse: Optional[str] = None
    ville: Optional[str] = None
    province: Optional[str] = None
    code_postal: Optional[str] = None
    categorie_produits: Optional[str] = None
    conditions_paiement: Optional[str] = None
    delai_livraison_moyen: Optional[int] = None
    contact_commercial: Optional[str] = None
    contact_technique: Optional[str] = None
    evaluation_qualite: Optional[float] = None
    certifications: Optional[str] = None
    notes: Optional[str] = None
    notes_evaluation: Optional[str] = None
    est_actif: Optional[bool] = None


class PurchaseOrderCreate(BaseModel):
    project_id: Optional[int] = None
    date_livraison_prevue: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("date_livraison_prevue", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


@router.get("/purchase-orders")
async def list_all_purchase_orders(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    statut: Optional[str] = None,
    project_id: Optional[int] = None,
):
    """List ALL purchase orders across all suppliers."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres, params = [], []
        if statut:
            wheres.append("bc.statut = %s")
            params.append(statut)
        if project_id:
            wheres.append("bc.project_id = %s")
            params.append(project_id)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(
            f"SELECT COUNT(*) as total FROM bons_commande bc WHERE {w}", params
        )
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT bc.id, bc.numero, bc.fournisseur_id, bc.project_id, "
            f"bc.date_commande, bc.date_livraison_prevue, bc.statut, "
            f"bc.montant_total, bc.notes, bc.created_at, "
            f"COALESCE(f.nom_fournisseur, c.nom, '') as fournisseur_nom, "
            f"p.nom_projet "
            f"FROM bons_commande bc "
            f"LEFT JOIN fournisseurs f ON bc.fournisseur_id = f.id "
            f"LEFT JOIN companies c ON f.company_id = c.id "
            f"LEFT JOIN projects p ON bc.project_id::text = p.id::text "
            f"WHERE {w} "
            f"ORDER BY bc.created_at DESC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_commande", "date_livraison_prevue", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            if d.get("montant_total") is not None:
                d["montant_total"] = float(d["montant_total"])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_all_purchase_orders error: %s", exc)
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
async def list_suppliers(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=200),
    search: Optional[str] = None,
    categorie: Optional[str] = None,
    actif: Optional[bool] = None,
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Real columns from erp_database.py: nom_fournisseur, categorie_produits, est_actif
        wheres, params = [], []
        if search:
            wheres.append("(LOWER(COALESCE(f.nom_fournisseur, c.nom, '')) LIKE %s OR LOWER(COALESCE(f.email,'')) LIKE %s)")
            s = f"%{search.lower()}%"
            params.extend([s, s])
        if categorie:
            wheres.append("f.categorie_produits = %s")
            params.append(categorie)
        if actif is not None:
            wheres.append("f.est_actif = %s")
            params.append(actif)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM fournisseurs f LEFT JOIN companies c ON f.company_id = c.id WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT f.*, c.nom as company_nom "
            f"FROM fournisseurs f "
            f"LEFT JOIN companies c ON f.company_id = c.id "
            f"WHERE {w} "
            f"ORDER BY COALESCE(f.nom_fournisseur, c.nom, '') ASC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            # Map: use nom_fournisseur, fallback to company name
            d["nom"] = d.get("nom_fournisseur") or d.get("company_nom") or ""
            d["contact_nom"] = d.get("contact_principal")
            d["categorie"] = d.get("categorie_produits")
            d["evaluation"] = float(d.get("evaluation_qualite") or 0)
            d["actif"] = d.get("est_actif", d.get("active", True))
            for k in list(d.keys()):
                if d[k] and hasattr(d[k], 'isoformat'):
                    d[k] = str(d[k])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_suppliers error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/{supplier_id}")
async def get_supplier(supplier_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM fournisseurs WHERE id = %s", (supplier_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Fournisseur non trouvé")
        d = dict(row)
        if d.get("created_at"):
            d["created_at"] = str(d["created_at"])
        # Get purchase orders
        cursor.execute(
            "SELECT id, numero, date_commande, date_livraison_prevue, statut, "
            "montant_total, notes, created_at FROM bons_commande "
            "WHERE fournisseur_id = %s ORDER BY created_at DESC LIMIT 20",
            (supplier_id,),
        )
        orders = []
        for o in cursor.fetchall():
            od = dict(o)
            for k in ("date_commande", "date_livraison_prevue", "created_at"):
                if od.get(k):
                    od[k] = str(od[k])
            orders.append(od)
        d["bons_commande"] = orders
        return d
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_supplier error: %s", exc)
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
async def create_supplier(body: SupplierCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO fournisseurs (company_id, nom_fournisseur, code_fournisseur, "
            "contact_principal, email, telephone, adresse, ville, province, code_postal, "
            "categorie_produits, conditions_paiement, delai_livraison_moyen, "
            "contact_commercial, contact_technique, evaluation_qualite, "
            "certifications, notes, notes_evaluation, est_actif, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,"
            "TRUE,CURRENT_TIMESTAMP) RETURNING id",
            (body.company_id, body.nom_fournisseur, body.code_fournisseur,
             body.contact_principal, body.email, body.telephone,
             body.adresse, body.ville, body.province, body.code_postal,
             body.categorie_produits, body.conditions_paiement,
             body.delai_livraison_moyen, body.contact_commercial,
             body.contact_technique, body.evaluation_qualite,
             body.certifications, body.notes, body.notes_evaluation),
        )
        row = cursor.fetchone()
        return {"id": row["id"], "message": "Fournisseur créé"}
    except Exception as exc:
        logger.error("create_supplier error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/{supplier_id}")
async def update_supplier(supplier_id: int, body: SupplierUpdate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    ALLOWED_COLS = {"nom_fournisseur", "contact_principal", "email", "telephone",
                     "adresse", "ville", "province", "code_postal",
                     "categorie_produits", "conditions_paiement",
                     "delai_livraison_moyen", "contact_commercial",
                     "contact_technique", "evaluation_qualite",
                     "certifications", "notes", "notes_evaluation", "est_actif"}
    fields = {k: v for k, v in body.model_dump().items() if v is not None and k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ a modifier")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        from psycopg2 import sql as _sql
        # Keys déjà validées contre ALLOWED_COLS — sql.Identifier sécurise le rendu.
        set_clauses = [_sql.SQL("{} = %s").format(_sql.Identifier(k)) for k in fields]
        set_clauses.append(_sql.SQL("updated_at = CURRENT_TIMESTAMP"))
        values = list(fields.values()) + [supplier_id]
        query = _sql.SQL("UPDATE fournisseurs SET {sets} WHERE id = %s").format(
            sets=_sql.SQL(", ").join(set_clauses),
        )
        cursor.execute(query, values)
        return {"message": "Fournisseur mis à jour"}
    except Exception as exc:
        logger.error("update_supplier error: %s", exc)
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
# PURCHASE ORDERS
# ============================================

@router.get("/{supplier_id}/orders")
async def list_purchase_orders(
    supplier_id: int, user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=100),
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) as total FROM bons_commande WHERE fournisseur_id = %s",
            (supplier_id,),
        )
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            "SELECT id, numero, date_commande, date_livraison_prevue, statut, "
            "montant_total, notes, created_at FROM bons_commande "
            "WHERE fournisseur_id = %s ORDER BY created_at DESC LIMIT %s OFFSET %s",
            (supplier_id, per_page, offset),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("date_commande", "date_livraison_prevue", "created_at"):
                if d.get(k):
                    d[k] = str(d[k])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_purchase_orders error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/{supplier_id}/orders")
async def create_purchase_order(
    supplier_id: int, body: PurchaseOrderCreate, user: ErpUser = Depends(get_current_user)
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Get fournisseur name for denormalized column
        fournisseur_nom = None
        try:
            cursor.execute(
                "SELECT COALESCE(f.nom_fournisseur, c.nom, '') as nom "
                "FROM fournisseurs f LEFT JOIN companies c ON f.company_id = c.id "
                "WHERE f.id = %s", (supplier_id,))
            fn_row = cursor.fetchone()
            if fn_row:
                fournisseur_nom = fn_row["nom"]
        except Exception:
            pass
        # TEMP-then-UPDATE pattern (race-safe numero generation)
        cursor.execute(
            "INSERT INTO bons_commande (numero, fournisseur_id, fournisseur_nom, project_id, "
            "date_commande, date_livraison_prevue, statut, notes, created_at) "
            "VALUES ('TEMP', %s, %s, %s, CURRENT_DATE, %s, 'Brouillon', %s, CURRENT_TIMESTAMP) RETURNING id",
            (supplier_id, fournisseur_nom, body.project_id, body.date_livraison_prevue, body.notes),
        )
        row = cursor.fetchone()
        bc_id = row["id"]
        numero = f"BC-{bc_id:05d}"
        cursor.execute("UPDATE bons_commande SET numero = %s WHERE id = %s", (numero, bc_id))

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
                    cursor.execute(
                        "INSERT INTO dossier_achats (dossier_id, achat_id, date_association) "
                        "VALUES (%s, %s, CURRENT_TIMESTAMP) ON CONFLICT (dossier_id, achat_id) DO NOTHING",
                        (dossier_row["dossier_id"], bc_id),
                    )
            except Exception:
                pass

        return {"id": bc_id, "numero": numero, "message": "Bon de commande créé"}
    except Exception as exc:
        logger.error("create_purchase_order error: %s", exc)
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
# PURCHASE ORDER DATE UPDATE (Gantt drag)
# ============================================


class PurchaseOrderDateUpdate(BaseModel):
    date_commande: Optional[str] = None
    date_livraison_prevue: Optional[str] = None

    @field_validator("date_commande", "date_livraison_prevue", mode="before")
    @classmethod
    def _clean_date(cls, v):
        return _empty_to_none(v)


@router.put("/purchase-orders/{bc_id}/dates")
async def update_purchase_order_dates(bc_id: int, body: PurchaseOrderDateUpdate, user: ErpUser = Depends(get_current_user)):
    """Update dates of a purchase order (used by Gantt drag)."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    for dk in ("date_commande", "date_livraison_prevue"):
        if fields.get(dk) == "":
            fields[dk] = None
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        set_parts = [f"{k} = %s" for k in fields]
        values = list(fields.values()) + [bc_id]
        cursor.execute(
            f"UPDATE bons_commande SET {', '.join(set_parts)} WHERE id = %s",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Bon de commande non trouve")
        conn.commit()
        return {"message": "Dates du bon de commande mises a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_purchase_order_dates error: %s", exc)
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
# PURCHASE ORDER STATUS UPDATE
# ============================================

VALID_BC_STATUTS = {'Brouillon', 'Envoye', 'Confirme', 'En cours', 'Recu', 'Facture', 'Annule'}


@router.put("/purchase-orders/{bc_id}/status")
async def update_purchase_order_status(bc_id: int, body: dict = Body(...), user: ErpUser = Depends(get_current_user)):
    """Update the status of a purchase order.

    FIX P0: quand le statut passe a 'Recu', on cree automatiquement un mouvement
    ENTREE pour chaque ligne du BC qui a un produit_id (et on incremente
    stock_disponible). Sans ce comportement, le manuel utilisateur mentait —
    le stock restait toujours faux apres une reception physique.
    """
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    statut = body.get("statut")
    if statut not in VALID_BC_STATUTS:
        raise HTTPException(status_code=400, detail=f"Statut invalide. Valeurs permises: {', '.join(sorted(VALID_BC_STATUTS))}")

    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # FIX P0 (round 7): forcer autocommit=False pour que SELECT FOR UPDATE
        # tienne son lock pendant la reception (UPDATE produits + INSERT
        # mouvements). En autocommit (defaut), FOR UPDATE est inopérant.
        try:
            prev_autocommit = conn.autocommit
        except Exception:
            prev_autocommit = None
        try:
            conn.autocommit = False
        except Exception:
            pass
        # Lire le statut actuel pour ne pas re-creer les mouvements ENTREE si
        # l'utilisateur clique deux fois sur "Recu".
        cursor.execute("SELECT statut, numero_bc FROM bons_commande WHERE id = %s", (bc_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bon de commande non trouve")
        ancien_statut = row["statut"]
        numero_bc = row.get("numero_bc") or f"BC-{bc_id}"

        cursor.execute("UPDATE bons_commande SET statut = %s WHERE id = %s", (statut, bc_id))

        # Auto-reception: ENTREE stock + mouvements_stock
        if statut == 'Recu' and ancien_statut != 'Recu':
            # Verifier que les tables existent (defensif tenant legacy)
            cursor.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_name = 'bon_commande_lignes' AND table_schema = current_schema()"
            )
            has_lignes = cursor.fetchone() is not None
            cursor.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_name = 'produits' AND table_schema = current_schema()"
            )
            has_produits = cursor.fetchone() is not None
            cursor.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_name = 'mouvements_stock' AND table_schema = current_schema()"
            )
            has_mouvements = cursor.fetchone() is not None

            if has_lignes and has_produits:
                cursor.execute(
                    "SELECT id, produit_id, quantite, prix_unitaire FROM bon_commande_lignes "
                    "WHERE bon_commande_id = %s AND produit_id IS NOT NULL",
                    (bc_id,),
                )
                # FIX P0: dedupliquer par produit_id pour eviter double-stocking
                # si le BC contient plusieurs lignes du meme produit (sinon
                # mouvements_stock affiche des quantite_avant/apres incoherents).
                lignes_par_produit: dict[int, float] = {}
                for ligne in cursor.fetchall():
                    pid = ligne["produit_id"]
                    if not pid:
                        continue
                    qty = float(ligne["quantite"] or 0)
                    if qty <= 0:
                        continue
                    # Conserver le cout_unitaire du dernier item (suffisant pour audit)
                    cu = float(ligne["prix_unitaire"] or 0)
                    if pid in lignes_par_produit:
                        lignes_par_produit[pid] = (lignes_par_produit[pid][0] + qty, cu)
                    else:
                        lignes_par_produit[pid] = (qty, cu)

                for produit_id, (quantite, cout_unit) in lignes_par_produit.items():
                    # FIX P0: SELECT FOR UPDATE pour lock pessimiste avant UPDATE
                    # — evite drift d'audit si 2 admins receptionnent en concurrent.
                    cursor.execute(
                        "SELECT id FROM produits WHERE id = %s FOR UPDATE",
                        (produit_id,),
                    )
                    if cursor.fetchone() is None:
                        continue  # produit supprime entretemps
                    cursor.execute(
                        "UPDATE produits SET stock_disponible = COALESCE(stock_disponible, 0) + %s, "
                        "updated_at = NOW() WHERE id = %s "
                        "RETURNING stock_disponible",
                        (quantite, produit_id),
                    )
                    upd = cursor.fetchone()
                    if upd and has_mouvements:
                        nouveau = float(upd["stock_disponible"] or 0)
                        avant = nouveau - quantite
                        try:
                            cursor.execute(
                                "INSERT INTO mouvements_stock "
                                "(produit_id, type_mouvement, quantite, quantite_avant, quantite_apres, "
                                " reference_document, reference_type, motif, cout_unitaire, cout_total, created_at) "
                                "VALUES (%s, 'ENTREE', %s, %s, %s, %s, 'BON_RECEPTION', %s, %s, %s, NOW())",
                                (produit_id, quantite, avant, nouveau,
                                 numero_bc, f"Reception BC {numero_bc}",
                                 cout_unit, cout_unit * quantite),
                            )
                        except Exception as mvt_exc:
                            logger.warning(
                                "audit mouvements_stock ENTREE failed for produit %s (BC %s): %s",
                                produit_id, bc_id, mvt_exc,
                            )

        conn.commit()
        return {"message": "Statut mis a jour"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("update_purchase_order_status error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour du statut")
    finally:
        if cursor:
            cursor.close()
        # Restaurer l'autocommit avant de retourner la connexion au pool.
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# PURCHASE ORDER LINES (Lignes de BC)
# ============================================

class BCLineCreate(BaseModel):
    produit_id: Optional[int] = None
    description: str
    quantite: float = Field(default=1, gt=0)
    unite: Optional[str] = None
    prix_unitaire: float = Field(default=0, ge=0)


def _ensure_bc_lignes_table(cursor):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS bon_commande_lignes (
            id SERIAL PRIMARY KEY,
            bon_commande_id INTEGER NOT NULL,
            produit_id INTEGER,
            description TEXT,
            quantite NUMERIC(15,4) DEFAULT 1,
            unite TEXT,
            prix_unitaire NUMERIC(15,2) DEFAULT 0,
            montant NUMERIC(15,2) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)


def _recalculate_bc_total(cursor, bc_id):
    cursor.execute(
        "SELECT COALESCE(SUM(montant), 0) as total FROM bon_commande_lignes WHERE bon_commande_id = %s",
        (bc_id,),
    )
    total = float(cursor.fetchone()["total"])
    cursor.execute(
        "UPDATE bons_commande SET montant_total = %s WHERE id = %s",
        (total, bc_id),
    )


@router.get("/orders/{bc_id}/lines")
async def list_bc_lines(bc_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_bc_lignes_table(cursor)
        cursor.execute(
            "SELECT l.id, l.bon_commande_id, l.produit_id, l.description, "
            "l.quantite, l.unite, l.prix_unitaire, l.montant, l.created_at, "
            "p.nom as produit_nom, p.code_produit "
            "FROM bon_commande_lignes l "
            "LEFT JOIN produits p ON l.produit_id = p.id "
            "WHERE l.bon_commande_id = %s ORDER BY l.id",
            (bc_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("quantite", "prix_unitaire", "montant"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            items.append(d)
        return {"items": items}
    except Exception as exc:
        logger.error("list_bc_lines error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/orders/{bc_id}/lines")
async def add_bc_line(bc_id: int, body: BCLineCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_bc_lignes_table(cursor)
        montant = round(body.quantite * body.prix_unitaire, 2)
        cursor.execute(
            "INSERT INTO bon_commande_lignes (bon_commande_id, produit_id, description, "
            "quantite, unite, prix_unitaire, montant, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,CURRENT_TIMESTAMP) RETURNING id",
            (bc_id, body.produit_id, body.description,
             body.quantite, body.unite, body.prix_unitaire, montant),
        )
        line_id = cursor.fetchone()["id"]
        _recalculate_bc_total(cursor, bc_id)
        return {"id": line_id, "montant": montant, "message": "Ligne ajoutee"}
    except Exception as exc:
        logger.error("add_bc_line error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/orders/{bc_id}/lines/{line_id}")
async def delete_bc_line(bc_id: int, line_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM bon_commande_lignes WHERE id = %s AND bon_commande_id = %s",
            (line_id, bc_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Ligne non trouvée")
        _recalculate_bc_total(cursor, bc_id)
        return {"message": "Ligne supprimée"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_bc_line error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/purchase-orders/{bc_id}")
async def delete_purchase_order(bc_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT id, statut FROM bons_commande WHERE id = %s", (bc_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bon de commande non trouvé")
        statut = (row.get("statut") or "").lower()
        if statut in ("recu", "facture"):
            raise HTTPException(status_code=400, detail="Impossible de supprimer un bon recu ou facture")
        for tbl in ("bon_commande_lignes", "dossier_achats", "achat_assignations"):
            try:
                col = "achat_id" if tbl == "dossier_achats" else "bon_commande_id"
                cursor.execute(f"DELETE FROM {tbl} WHERE {col} = %s", (bc_id,))
            except Exception:
                db.set_tenant(conn, user.schema)
        try:
            cursor.execute("UPDATE depenses SET bon_commande_id = NULL WHERE bon_commande_id = %s", (bc_id,))
        except Exception:
            db.set_tenant(conn, user.schema)
        # Cleanup Gantt dependencies attached to this bon de commande
        try:
            cursor.execute(
                "DELETE FROM gantt_dependencies "
                "WHERE (source_type = 'bc' AND source_id = %s) "
                "   OR (target_type = 'bc' AND target_id = %s)",
                (str(bc_id), str(bc_id)),
            )
        except Exception:
            db.set_tenant(conn, user.schema)
        cursor.execute("DELETE FROM bons_commande WHERE id = %s", (bc_id,))
        # Bug pre-existant fixe : sans conn.commit() la transaction etait
        # rollback a conn.close() (psycopg2 non-autocommit par defaut) et
        # le DELETE n'etait jamais persiste.
        conn.commit()
        return {"message": "Bon de commande supprime"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("delete_purchase_order error: %s", exc)
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
        conn.close()


# ============================================================
# BON DE COMMANDE — HTML Generation
# ============================================================

def _fmt_money(val) -> str:
    try:
        v = float(val or 0)
    except (ValueError, TypeError):
        v = 0.0
    return f"{v:,.2f} $"


BC_CONDITIONS = [
    "Les prix sont en dollars canadiens (CAD) et ne comprennent pas les taxes applicables.",
    "Les materiaux doivent etre conformes aux specifications et normes en vigueur.",
    "Le fournisseur doit aviser l'acheteur de tout retard de livraison des que possible.",
    "Les materiaux endommages ou non conformes seront retournes aux frais du fournisseur.",
    "La facturation doit inclure le numero de bon de commande comme reference.",
    "Les conditions de paiement sont selon les termes convenus avec le fournisseur.",
]


def _generate_bc_html(bc, lignes, fournisseur, enterprise, theme=None):
    """Generate a professional HTML document for a bon de commande.

    `theme` is an optional tenant color palette from get_document_theme().
    Falls back to DEFAULT_DOCUMENT_THEME so rendering never breaks.
    """
    from .html_utils import DEFAULT_DOCUMENT_THEME, THEME_KEYS
    _t = dict(DEFAULT_DOCUMENT_THEME)
    if isinstance(theme, dict):
        for k in THEME_KEYS:
            v = theme.get(k)
            if isinstance(v, str) and v.strip():
                _t[k] = v
    if enterprise:
        ent_name = enterprise.get("nom", "") or enterprise.get("nom_entreprise", "") or "Entreprise"
        ent_address = enterprise.get("adresse", "")
        ent_ville = enterprise.get("ville", "")
        ent_province = enterprise.get("province", "")
        ent_cp = enterprise.get("code_postal", "")
        ent_phone = enterprise.get("telephone", "") or enterprise.get("telephone_bureau", "")
        ent_email = enterprise.get("courriel", "") or enterprise.get("email", "")
        ent_rbq = enterprise.get("rbq", "") or enterprise.get("numero_rbq", "")
        ent_neq = enterprise.get("neq", "") or enterprise.get("numero_neq", "")
        ent_tps = enterprise.get("tps", "") or enterprise.get("numero_tps", "")
        ent_tvq = enterprise.get("tvq", "") or enterprise.get("numero_tvq", "")
    else:
        ent_name = "Entreprise"
        ent_address = ent_ville = ent_province = ent_cp = ""
        ent_phone = ent_email = ent_rbq = ent_neq = ent_tps = ent_tvq = ""

    four_name = "Fournisseur"
    four_address = four_phone = four_email = four_contact = ""
    if fournisseur:
        four_name = fournisseur.get("nom", "") or fournisseur.get("nom_fournisseur", "") or "Fournisseur"
        four_address = fournisseur.get("adresse", "") or ""
        four_phone = fournisseur.get("telephone", "") or ""
        four_email = fournisseur.get("email", "") or ""
        four_contact = fournisseur.get("contact_commercial", "") or fournisseur.get("contact_principal", "") or ""

    numero = bc.get("numero", "") or bc.get("numero_bc", "") or ""
    date_commande = str(bc.get("date_commande", "") or bc.get("created_at", ""))[:10]
    date_livraison = str(bc.get("date_livraison_prevue", ""))[:10] if bc.get("date_livraison_prevue") else ""
    projet_nom = bc.get("nom_projet", "") or ""
    notes = bc.get("notes", "") or ""
    conditions_paiement = fournisseur.get("conditions_paiement", "") if fournisseur else ""

    lignes_total = sum(float(l.get("montant", 0) or l.get("montant_ligne", 0) or 0) for l in lignes)
    if lignes_total > 0:
        sous_total_ht = lignes_total
    else:
        # Fallback: use montant_total from BC record
        try:
            sous_total_ht = float(bc.get("montant_total", 0) or 0)
        except (ValueError, TypeError):
            sous_total_ht = 0.0
    tps = round(sous_total_ht * 0.05, 2)
    tvq = round(sous_total_ht * 0.09975, 2)
    total_ttc = round(sous_total_ht + tps + tvq, 2)

    lines_html = ""
    for l in lignes:
        desc = l.get("description", "")
        code = l.get("code_produit", "") or l.get("code_article", "") or ""
        unite = l.get("unite", "")
        qte = float(l.get("quantite", 0) or 0)
        prix = float(l.get("prix_unitaire", 0) or 0)
        montant = float(l.get("montant", 0) or l.get("montant_ligne", 0) or 0)
        lines_html += f"""
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">{desc}{f' <span style="color:#718096;font-size:11px;">({code})</span>' if code else ''}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;">{unite}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">{qte:,.2f}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">{_fmt_money(prix)}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;">{_fmt_money(montant)}</td>
            </tr>"""

    conditions_html = "".join(f"<li>{c}</li>\n" for c in BC_CONDITIONS)

    html = f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Bon de commande {numero}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}body{{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:#2d3748;line-height:1.5;background:#fff}}
.page{{max-width:850px;margin:0 auto;padding:40px}}.header{{display:flex;justify-content:space-between;align-items:stretch;margin-bottom:0}}
.header-left{{display:flex;align-items:center;gap:16px;max-width:55%}}.enterprise-name{{font-size:22px;font-weight:800;color:{_t['primary']};margin-bottom:4px}}.enterprise-info{{font-size:11px;color:#64748b;line-height:1.5}}.enterprise-info .ent-nums{{color:#94a3b8;font-size:10px;margin-top:2px}}
.header-right{{background:{_t['primary']};color:{_t['header_text']};padding:20px 28px;border-radius:6px;text-align:center;display:flex;flex-direction:column;justify-content:center;min-width:180px}}.doc-label{{font-size:24px;font-weight:800;letter-spacing:2px;color:{_t['header_text']}}}.doc-sublabel{{font-size:11px;color:{_t['accent_light']};text-transform:uppercase;letter-spacing:1px}}.doc-numero{{font-size:14px;color:{_t['accent_light']};margin-top:4px;font-weight:600}}
.header-separator{{height:4px;background:linear-gradient(90deg,{_t['primary']} 0%,{_t['accent']} 50%,{_t['primary']} 100%);border-radius:2px;margin:20px 0 24px}}
.info-grid{{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px}}.info-box{{background:{_t['info_bg']};border-radius:6px;padding:16px 20px;border-left:4px solid {_t['accent']}}}
.info-box h4{{font-size:11px;text-transform:uppercase;color:{_t['accent']};font-weight:700;letter-spacing:1px;margin-bottom:8px}}.info-box p{{font-size:13px;color:#334155}}.info-box .name{{font-size:15px;font-weight:700;color:{_t['primary']};margin-bottom:4px}}
table{{width:100%;border-collapse:collapse;margin-bottom:20px}}thead th{{background:{_t['primary']};color:{_t['header_text']};padding:10px 12px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;text-align:left}}
thead th:nth-child(2){{text-align:center}}thead th:nth-child(3),thead th:nth-child(4),thead th:nth-child(5){{text-align:right}}tbody td{{font-size:13px}}
.summary{{margin-left:auto;width:350px;margin-bottom:30px}}.summary-row{{display:flex;justify-content:space-between;padding:6px 0;font-size:13px}}
.summary-row.sub{{border-top:1px solid #e2e8f0;padding-top:8px;margin-top:4px}}.summary-row.total{{border-top:3px solid {_t['primary']};padding-top:10px;margin-top:8px;font-size:18px;font-weight:800;color:{_t['primary']}}}
.conditions{{margin-bottom:30px}}.conditions h3{{font-size:14px;font-weight:700;color:{_t['primary']};margin-bottom:10px;text-transform:uppercase}}.conditions ul{{font-size:12px;color:#4a5568;padding-left:20px}}.conditions li{{margin-bottom:4px}}
.notes{{background:#fffbeb;border:1px solid #f6e05e;border-radius:8px;padding:16px;margin-bottom:30px}}.notes h4{{font-size:12px;font-weight:700;color:#975a16;margin-bottom:6px;text-transform:uppercase}}.notes p{{font-size:12px;color:#744210}}
.signatures{{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px;padding-top:20px;border-top:1px solid #e2e8f0}}.sig-block{{text-align:center}}.sig-block h4{{font-size:13px;font-weight:700;color:{_t['primary']};margin-bottom:30px}}
.sig-line{{border-top:1px solid #2d3748;padding-top:8px;font-size:12px;color:#718096}}.footer{{margin-top:40px;padding-top:15px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#a0aec0}}
@media print{{.page{{padding:20px}}body{{-webkit-print-color-adjust:exact;print-color-adjust:exact}}}}
</style></head><body><div class="page">
<div class="header"><div class="header-left"><div><div class="enterprise-name">{ent_name}</div><div class="enterprise-info">
{f'{ent_address}, ' if ent_address else ''}{f'{ent_ville}, {ent_province} {ent_cp}' if ent_ville else ''}<br>{f'{ent_phone}' if ent_phone else ''}{f' | {ent_email}' if ent_email else ''}
<div class="ent-nums">{f'RBQ: {ent_rbq}' if ent_rbq else ''}{f' | NEQ: {ent_neq}' if ent_neq else ''}{f' | TPS: {ent_tps}' if ent_tps else ''}{f' | TVQ: {ent_tvq}' if ent_tvq else ''}</div>
</div></div></div><div class="header-right"><div class="doc-sublabel">Bon de commande</div><div class="doc-label">ACHAT</div><div class="doc-numero">{numero}</div></div></div>
<div class="header-separator"></div>
<div class="info-grid"><div class="info-box"><h4>Fournisseur</h4><p class="name">{four_name}</p>
{f'<p>{four_address}</p>' if four_address else ''}{f'<p>Tel: {four_phone}</p>' if four_phone else ''}{f'<p>{four_email}</p>' if four_email else ''}{f'<p>Contact: {four_contact}</p>' if four_contact else ''}
</div><div class="info-box"><h4>Informations de la commande</h4><p><strong>Date:</strong> {date_commande}</p>
{f'<p><strong>Livraison prevue:</strong> {date_livraison}</p>' if date_livraison else ''}{f'<p><strong>Projet:</strong> {projet_nom}</p>' if projet_nom else ''}{f'<p><strong>Conditions:</strong> {conditions_paiement}</p>' if conditions_paiement else ''}
</div></div>
<table><thead><tr><th style="width:40%">Description</th><th style="width:12%">Unite</th><th style="width:12%">Quantite</th><th style="width:16%">Prix unitaire</th><th style="width:20%">Montant</th></tr></thead>
<tbody>{lines_html}{'<tr><td colspan="5" style="padding:20px;text-align:center;color:#a0aec0;font-style:italic;">Aucune ligne</td></tr>' if not lignes else ''}</tbody></table>
<div class="summary"><div class="summary-row sub"><span>Sous-total HT</span><span style="font-weight:600">{_fmt_money(sous_total_ht)}</span></div>
<div class="summary-row"><span>TPS (5%)</span><span>{_fmt_money(tps)}</span></div><div class="summary-row"><span>TVQ (9,975%)</span><span>{_fmt_money(tvq)}</span></div>
<div class="summary-row total"><span>TOTAL TTC</span><span>{_fmt_money(total_ttc)}</span></div></div>
{f'<div class="notes"><h4>Notes</h4><p>{notes}</p></div>' if notes else ''}
<div class="conditions"><h3>Conditions d\'achat</h3><ul>{conditions_html}</ul></div>
<div class="signatures"><div class="sig-block"><h4>Acheteur</h4><div class="sig-line">Nom: _______________________________<br>Date: _______________________________<br>Signature: ___________________________</div></div>
<div class="sig-block"><h4>Fournisseur</h4><div class="sig-line">Nom: _______________________________<br>Date: _______________________________<br>Signature: ___________________________</div></div></div>
<div class="footer">{ent_name} — Bon de commande {numero} — Genere le {datetime.now().strftime('%Y-%m-%d %H:%M')}</div>
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


@router.post("/orders/{bc_id}/generate-html")
async def generate_bc_html(bc_id: int, user: ErpUser = Depends(get_current_user)):
    """Generate a professional HTML document for a bon de commande."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM bons_commande WHERE id = %s", (bc_id,))
        bc = cursor.fetchone()
        if not bc:
            raise HTTPException(status_code=404, detail="Bon de commande non trouvé")
        bc = dict(bc)

        cursor.execute("SELECT * FROM bon_commande_lignes WHERE bon_commande_id = %s ORDER BY id ASC", (bc_id,))
        lignes = [dict(r) for r in cursor.fetchall()]

        fournisseur = None
        four_id = bc.get("fournisseur_id")
        if four_id:
            try:
                cursor.execute("SELECT * FROM fournisseurs WHERE id = %s", (four_id,))
                row = cursor.fetchone()
                if row:
                    fournisseur = dict(row)
                    cid = fournisseur.get("company_id")
                    if cid:
                        cursor.execute("SELECT * FROM companies WHERE id = %s", (cid,))
                        comp = cursor.fetchone()
                        if comp:
                            comp = dict(comp)
                            fournisseur["adresse"] = fournisseur.get("adresse") or comp.get("adresse", "")
                            fournisseur["telephone"] = fournisseur.get("telephone") or comp.get("telephone", "")
                            fournisseur["email"] = fournisseur.get("email") or comp.get("email", "")
            except Exception:
                pass

        proj_id = bc.get("project_id")
        if proj_id:
            try:
                cursor.execute("SELECT nom_projet FROM projects WHERE id = %s", (proj_id,))
                proj_row = cursor.fetchone()
                if proj_row:
                    bc["nom_projet"] = dict(proj_row).get("nom_projet", "")
            except Exception:
                pass

        from .html_utils import get_company_info, get_document_theme
        enterprise = get_company_info(cursor)
        theme = get_document_theme(cursor)

        html = _generate_bc_html(bc, lignes, fournisseur, enterprise, theme=theme)
        return {"html": html, "bcId": bc_id, "numero": bc.get("numero", "")}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("generate_bc_html error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la generation HTML")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
