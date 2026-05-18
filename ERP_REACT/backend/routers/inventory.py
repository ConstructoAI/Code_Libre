"""
ERP React - Inventory & Products Router
Produits, stock, mouvements, alertes.
Based on produits.py (3,289 lines) + inventory.py (2,919 lines).
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from typing import Optional

from ..erp_auth import get_current_user, require_role, ErpUser
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Inventory & Products"])

# RBAC: roles autorises a creer/modifier produits, mouvements, BOM.
# admin/super_admin/gestionnaire/magasinier conformement au modele de roles.
INVENTORY_WRITE_ROLES = ("admin", "super_admin", "gestionnaire", "magasinier")


class ProductCreate(BaseModel):
    nom: str
    code_produit: Optional[str] = None
    description: Optional[str] = None
    categorie: Optional[str] = None
    materiau: Optional[str] = None
    unite_vente: str = "unite"
    cout_revient: Optional[float] = None
    prix_unitaire: Optional[float] = None
    fournisseur_principal: Optional[str] = None
    stock_disponible: float = 0
    stock_minimum: float = 0
    emplacement_stock: Optional[str] = None
    notes_techniques: Optional[str] = None

    @field_validator("prix_unitaire", "cout_revient")
    @classmethod
    def _non_negative_prices(cls, v):
        if v is not None and v < 0:
            raise ValueError("Le prix ne peut pas etre negatif")
        return v

    @field_validator("stock_disponible", "stock_minimum")
    @classmethod
    def _non_negative_stocks(cls, v):
        if v is not None and v < 0:
            raise ValueError("Le stock ne peut pas etre negatif")
        return v


class ProductUpdate(BaseModel):
    nom: Optional[str] = None
    code_produit: Optional[str] = None
    description: Optional[str] = None
    categorie: Optional[str] = None
    materiau: Optional[str] = None
    unite_vente: Optional[str] = None
    cout_revient: Optional[float] = None
    prix_unitaire: Optional[float] = None
    fournisseur_principal: Optional[str] = None
    stock_minimum: Optional[float] = None
    emplacement_stock: Optional[str] = None
    notes_techniques: Optional[str] = None
    active: Optional[bool] = None

    @field_validator("prix_unitaire", "cout_revient", "stock_minimum")
    @classmethod
    def _non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("La valeur ne peut pas etre negative")
        return v


class StockMovement(BaseModel):
    produit_id: int
    type_mouvement: str  # ENTREE, SORTIE, AJUSTEMENT
    quantite: float
    reference: Optional[str] = None
    motif: Optional[str] = None


class ComposantCreate(BaseModel):
    enfant_produit_id: int
    quantite: float = 1
    unite: Optional[str] = None
    notes: Optional[str] = None


class ComposantUpdate(BaseModel):
    quantite: Optional[float] = None
    unite: Optional[str] = None
    notes: Optional[str] = None


# ============================================
# PRODUCTS
# ============================================

@router.get("/products")
async def list_products(
    user: ErpUser = Depends(get_current_user),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    categorie: Optional[str] = None,
    low_stock: bool = Query(False),
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres, params = ["active = TRUE"], []
        if search:
            wheres.append("(LOWER(COALESCE(nom,'')) LIKE %s OR LOWER(COALESCE(code_produit,'')) LIKE %s)")
            s = f"%{search.lower()}%"
            params.extend([s, s])
        if categorie:
            wheres.append("categorie = %s")
            params.append(categorie)
        if low_stock:
            wheres.append("stock_disponible <= stock_minimum AND stock_minimum > 0")
        w = " AND ".join(wheres)
        cursor.execute(f"SELECT COUNT(*) as total FROM produits WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT * FROM produits WHERE {w} ORDER BY COALESCE(nom, '') ASC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in list(d.keys()):
                if d[k] and hasattr(d[k], 'isoformat'):
                    d[k] = str(d[k])
            for k in ("cout_revient", "prix_unitaire"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_products error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/products/categories")
async def list_product_categories(user: ErpUser = Depends(get_current_user)):
    """List distinct product categories."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT DISTINCT categorie FROM produits WHERE categorie IS NOT NULL "
            "AND active = TRUE ORDER BY categorie"
        )
        return {"categories": [row["categorie"] for row in cursor.fetchall()]}
    except Exception as exc:
        logger.error("list_categories error: %s", exc)
        return {"categories": []}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/products/{product_id}")
async def get_product(product_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM produits WHERE id = %s", (product_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Produit non trouvé")
        d = dict(row)
        for k in ("created_at", "updated_at"):
            if d.get(k):
                d[k] = str(d[k])
        for k in ("cout_revient", "prix_unitaire"):
            if d.get(k):
                d[k] = float(d[k])
        # Get recent movements
        cursor.execute(
            "SELECT id, type_mouvement, quantite, reference_document, motif, created_at "
            "FROM mouvements_stock WHERE produit_id = %s "
            "ORDER BY created_at DESC LIMIT 20",
            (product_id,),
        )
        movements = []
        for m in cursor.fetchall():
            md = dict(m)
            if md.get("created_at"):
                md["created_at"] = str(md["created_at"])
            movements.append(md)
        d["mouvements"] = movements
        return d
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("get_product error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/products")
async def create_product(body: ProductCreate, user: ErpUser = Depends(require_role(*INVENTORY_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    code = body.code_produit.strip() if body.code_produit else None
    code = code or None  # '' -> None (NULL bypasses UNIQUE constraint)
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO produits (nom, code_produit, description, categorie, materiau, "
            "unite_vente, cout_revient, prix_unitaire, fournisseur_principal, stock_disponible, stock_minimum, "
            "emplacement_stock, notes_techniques, active, created_at, updated_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) "
            "RETURNING id",
            (body.nom, code, body.description, body.categorie, body.materiau,
             body.unite_vente, body.cout_revient, body.prix_unitaire,
             body.fournisseur_principal, body.stock_disponible, body.stock_minimum,
             body.emplacement_stock, body.notes_techniques),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Produit créé"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_product error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la creation du produit")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/products/{product_id}")
async def update_product(product_id: int, body: ProductUpdate, user: ErpUser = Depends(require_role(*INVENTORY_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    # ALLOWED_COLS exclut volontairement `stock_disponible` — toute modification
    # de stock DOIT passer par /stock-movements pour garantir l'audit trail
    # (mouvements_stock avec quantite_avant/quantite_apres + employee_id).
    ALLOWED_COLS = {"nom", "code_produit", "description", "categorie", "materiau",
                    "unite_vente", "cout_revient", "prix_unitaire", "fournisseur_principal",
                    "stock_minimum", "emplacement_stock", "notes_techniques", "active"}
    payload = body.model_dump(exclude_unset=True)
    fields = {k: v for k, v in payload.items() if k in ALLOWED_COLS}
    if not fields:
        raise HTTPException(status_code=400, detail="Aucun champ valide a mettre a jour")
    # Validation defensive (cf. ProductCreate validators)
    for price_field in ("prix_unitaire", "cout_revient"):
        if price_field in fields and fields[price_field] is not None and fields[price_field] < 0:
            raise HTTPException(status_code=400, detail=f"Le {price_field} ne peut pas etre negatif")
    if "stock_minimum" in fields and fields["stock_minimum"] is not None and fields["stock_minimum"] < 0:
        raise HTTPException(status_code=400, detail="Le stock_minimum ne peut pas etre negatif")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        set_parts = [f"{k} = %s" for k in fields]
        set_parts.append("updated_at = CURRENT_TIMESTAMP")
        values = list(fields.values())
        values.append(product_id)
        cursor.execute(f"UPDATE produits SET {', '.join(set_parts)} WHERE id = %s", values)
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Produit introuvable")
        conn.commit()
        return {"id": product_id, "message": "Produit mis a jour"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("update_product error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour du produit")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# STOCK MOVEMENTS
# ============================================

@router.post("/stock-movements")
async def create_stock_movement(body: StockMovement, user: ErpUser = Depends(require_role(*INVENTORY_WRITE_ROLES))):
    """Create a stock movement and update product quantity."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if body.type_mouvement not in ("ENTREE", "SORTIE", "AJUSTEMENT"):
        raise HTTPException(status_code=400, detail="Type de mouvement invalide")
    if body.type_mouvement == "AJUSTEMENT" and body.quantite < 0:
        raise HTTPException(status_code=400, detail="Quantite ne peut pas etre negative")
    if body.type_mouvement != "AJUSTEMENT" and body.quantite <= 0:
        raise HTTPException(status_code=400, detail="Quantite doit etre positive")
    conn = db.get_conn()
    cursor = None
    prev_autocommit = None
    try:
        # FIX (V2): désactiver autocommit AVANT de créer le curseur et AVANT
        # set_tenant, sinon le SELECT FOR UPDATE ne tient pas son lock pendant
        # la séquence SELECT -> INSERT mouvement -> UPDATE stock, et 2 SORTIE
        # concurrentes peuvent lire le même stock_disponible (double soustraction).
        try:
            prev_autocommit = conn.autocommit
        except Exception:
            prev_autocommit = None
        try:
            conn.autocommit = False
        except Exception:
            pass
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        # Lock product row to prevent race conditions on concurrent movements
        cursor.execute(
            "SELECT stock_disponible FROM produits WHERE id = %s FOR UPDATE",
            (body.produit_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Produit non trouvé")
        quantite_avant = row["stock_disponible"] or 0
        # Calculate quantite_apres
        if body.type_mouvement == "ENTREE":
            quantite_apres = quantite_avant + body.quantite
        elif body.type_mouvement == "SORTIE":
            if body.quantite > quantite_avant:
                raise HTTPException(
                    status_code=400,
                    detail=f"Stock insuffisant: demande {body.quantite}, disponible {quantite_avant}",
                )
            quantite_apres = quantite_avant - body.quantite
        else:  # AJUSTEMENT
            quantite_apres = body.quantite
        # Record movement with audit trail
        cursor.execute(
            "INSERT INTO mouvements_stock (produit_id, type_mouvement, quantite, "
            "quantite_avant, quantite_apres, "
            "reference_document, motif, employee_id, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP) RETURNING id",
            (body.produit_id, body.type_mouvement, body.quantite,
             quantite_avant, quantite_apres,
             body.reference, body.motif, user.user_id),
        )
        mvt_id = cursor.fetchone()["id"]
        # Update stock
        cursor.execute(
            "UPDATE produits SET stock_disponible = %s, "
            "updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (quantite_apres, body.produit_id),
        )
        conn.commit()
        return {"id": mvt_id, "message": "Mouvement enregistre"}
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    except Exception as exc:
        logger.error("create_stock_movement error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors du mouvement de stock")
    finally:
        # Restaurer l'autocommit avant retour au pool.
        if prev_autocommit is not None:
            try:
                conn.autocommit = prev_autocommit
            except Exception:
                pass
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/stock-movements")
async def list_stock_movements(
    user: ErpUser = Depends(get_current_user),
    produit_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        wheres, params = [], []
        if produit_id:
            wheres.append("m.produit_id = %s")
            params.append(produit_id)
        w = " AND ".join(wheres) if wheres else "TRUE"
        cursor.execute(f"SELECT COUNT(*) as total FROM mouvements_stock m WHERE {w}", params)
        total = cursor.fetchone()["total"]
        offset = (page - 1) * per_page
        cursor.execute(
            f"SELECT m.id, m.produit_id, m.type_mouvement, m.quantite, m.reference_document, "
            f"m.motif, m.created_at, p.nom as produit_nom "
            f"FROM mouvements_stock m "
            f"LEFT JOIN produits p ON m.produit_id = p.id "
            f"WHERE {w} ORDER BY m.created_at DESC LIMIT %s OFFSET %s",
            params + [per_page, offset],
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("created_at"):
                d["created_at"] = str(d["created_at"])
            items.append(d)
        return {"items": items, "total": total, "page": page, "per_page": per_page}
    except Exception as exc:
        logger.error("list_stock_movements error: %s", exc)
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
# INVENTORY STATS
# ============================================

@router.get("/inventory/stats")
async def get_inventory_stats(user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) as total_produits, "
            "COUNT(CASE WHEN stock_disponible <= stock_minimum AND stock_minimum > 0 THEN 1 END) as alertes_stock, "
            "COALESCE(SUM(stock_disponible * COALESCE(cout_revient, prix_unitaire, 0)), 0) as valeur_inventaire, "
            "COUNT(DISTINCT categorie) as nb_categories "
            "FROM produits WHERE active = TRUE"
        )
        row = cursor.fetchone()
        return {
            "total_produits": row["total_produits"],
            "alertes_stock": row["alertes_stock"],
            "valeur_inventaire": round(float(row["valeur_inventaire"]), 2),
            "nb_categories": row["nb_categories"],
        }
    except Exception as exc:
        logger.error("get_inventory_stats error: %s", exc)
        return {"total_produits": 0, "alertes_stock": 0, "valeur_inventaire": 0, "nb_categories": 0}
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# ============================================
# BOM — COMPOSANTS (Parent-Enfant)
# ============================================

def _ensure_composants_table(cursor):
    cursor.execute(
        "CREATE TABLE IF NOT EXISTS produit_composants ("
        "id SERIAL PRIMARY KEY, "
        "parent_produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE, "
        "enfant_produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE, "
        "quantite NUMERIC(15,4) NOT NULL DEFAULT 1, "
        "unite TEXT, "
        "notes TEXT, "
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
        "UNIQUE(parent_produit_id, enfant_produit_id))"
    )


@router.get("/products/{product_id}/composants")
async def list_composants(product_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_composants_table(cursor)
        cursor.execute(
            "SELECT pc.id, pc.parent_produit_id, pc.enfant_produit_id, pc.quantite, pc.unite, pc.notes, "
            "p.nom AS enfant_nom, p.code_produit AS enfant_code, p.unite_vente, p.prix_unitaire, p.stock_disponible "
            "FROM produit_composants pc "
            "JOIN produits p ON pc.enfant_produit_id = p.id "
            "WHERE pc.parent_produit_id = %s ORDER BY p.nom ASC",
            (product_id,),
        )
        items = []
        for row in cursor.fetchall():
            d = dict(row)
            for k in ("quantite", "prix_unitaire", "stock_disponible"):
                if d.get(k) is not None:
                    d[k] = float(d[k])
            items.append(d)
        cursor.execute(
            "SELECT pc.id, pc.parent_produit_id, pc.quantite, pc.unite, "
            "p.nom AS parent_nom, p.code_produit AS parent_code "
            "FROM produit_composants pc "
            "JOIN produits p ON pc.parent_produit_id = p.id "
            "WHERE pc.enfant_produit_id = %s ORDER BY p.nom ASC",
            (product_id,),
        )
        parents = []
        for row in cursor.fetchall():
            d = dict(row)
            if d.get("quantite") is not None:
                d["quantite"] = float(d["quantite"])
            parents.append(d)
        return {"composants": items, "utilise_dans": parents}
    except Exception as exc:
        logger.error("list_composants error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement des composants")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/products/{product_id}/composants")
async def add_composant(product_id: int, body: ComposantCreate, user: ErpUser = Depends(require_role(*INVENTORY_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if body.enfant_produit_id == product_id:
        raise HTTPException(status_code=400, detail="Un produit ne peut pas etre son propre composant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_composants_table(cursor)
        cursor.execute("SELECT id FROM produits WHERE id IN (%s, %s)", (product_id, body.enfant_produit_id))
        found = {r["id"] for r in cursor.fetchall()}
        if product_id not in found:
            raise HTTPException(status_code=404, detail="Produit parent introuvable")
        if body.enfant_produit_id not in found:
            raise HTTPException(status_code=404, detail="Produit composant introuvable")
        # FIX P0 — detection circulaire BOM via CTE recursif.
        # L'ancien check ne detectait QUE le cycle direct A<->B mal construit;
        # un cycle A->B->C->A passait inapercu et causait une boucle infinie
        # cote calcul de cout / explosion de nomenclature.
        # On verifie si product_id (le futur parent) apparait deja quelque part
        # dans l'arbre des descendants de enfant_produit_id.
        cursor.execute(
            """
            WITH RECURSIVE descendants AS (
                SELECT enfant_produit_id AS id
                FROM produit_composants
                WHERE parent_produit_id = %s
                UNION
                SELECT pc.enfant_produit_id
                FROM produit_composants pc
                JOIN descendants d ON pc.parent_produit_id = d.id
            )
            SELECT 1 FROM descendants WHERE id = %s LIMIT 1
            """,
            (body.enfant_produit_id, product_id),
        )
        if cursor.fetchone():
            raise HTTPException(
                status_code=400,
                detail="Reference circulaire detectee dans la nomenclature (le composant contient deja ce produit dans sa hierarchie).",
            )
        cursor.execute(
            "INSERT INTO produit_composants (parent_produit_id, enfant_produit_id, quantite, unite, notes) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (product_id, body.enfant_produit_id, body.quantite, body.unite, body.notes),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"], "message": "Composant ajoute"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        if "unique" in str(exc).lower():
            raise HTTPException(status_code=400, detail="Ce composant existe deja pour ce produit")
        logger.error("add_composant error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de l'ajout du composant")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/products/{product_id}/composants/{composant_id}")
async def update_composant(product_id: int, composant_id: int, body: ComposantUpdate, user: ErpUser = Depends(require_role(*INVENTORY_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        updates = body.model_dump(exclude_unset=True)
        if not updates:
            return {"message": "Aucune modification"}
        set_parts, vals = [], []
        for k, v in updates.items():
            set_parts.append(f"{k} = %s")
            vals.append(v)
        vals.extend([composant_id, product_id])
        cursor.execute(
            f"UPDATE produit_composants SET {', '.join(set_parts)} WHERE id = %s AND parent_produit_id = %s", vals,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Composant introuvable")
        conn.commit()
        return {"message": "Composant mis a jour"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("update_composant error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/products/{product_id}/composants/{composant_id}")
async def delete_composant(product_id: int, composant_id: int, user: ErpUser = Depends(require_role(*INVENTORY_WRITE_ROLES))):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM produit_composants WHERE id = %s AND parent_produit_id = %s", (composant_id, product_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Composant introuvable")
        conn.commit()
        return {"message": "Composant supprime"}
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("delete_composant error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la suppression")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
