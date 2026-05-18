"""
ERP React - B2B Client Portal Router
Client-facing endpoints for B2B clients. All endpoints require B2B client JWT auth.
Data isolation: every query filters by client_id from JWT.
Reuses tables from b2b.py (_ensure_b2b_tables).
"""

import logging
from datetime import datetime, date
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from typing import Optional

from ..erp_auth import get_current_b2b_client, B2bClientUser
from .. import erp_database as db
from .b2b import _ensure_b2b_tables, _ensure_produits_columns

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/b2b-portal", tags=["B2B Client Portal"])

TPS_RATE = 0.05
TVQ_RATE = 0.09975

DATE_KEYS = ("created_at", "updated_at", "date_commande", "date_livraison_estimee",
             "date_limite", "date_debut", "date_fin_prevue", "date_fin_reelle",
             "date_signature", "date_expiration", "date_lecture", "last_login")
DECIMAL_KEYS = ("montant", "montant_total", "montant_ht", "montant_taxes", "montant_paye",
                "sous_total", "tps", "tvq", "total_ttc", "prix_unitaire", "montant_ligne",
                "budget_estime", "avancement_pourcentage")


def _serialize(row, date_keys=DATE_KEYS, decimal_keys=DECIMAL_KEYS):
    """Convert a DB row dict for JSON response."""
    d = dict(row)
    for k in date_keys:
        v = d.get(k)
        if isinstance(v, (datetime, date)):
            d[k] = v.isoformat()
    for k in decimal_keys:
        v = d.get(k)
        if isinstance(v, Decimal):
            d[k] = float(v)
    return d


def _empty_to_none(v):
    """Convert empty strings to None — used on date fields to avoid PostgreSQL
    'invalid input syntax for type date: ""' errors when frontend sends blank dates."""
    return None if isinstance(v, str) and v.strip() == "" else v


# ============================================
# PYDANTIC MODELS
# ============================================

class PortalDemandeCreate(BaseModel):
    titre: str
    description: Optional[str] = None
    categorie: Optional[str] = None
    budget_estime: Optional[float] = None
    date_limite: Optional[str] = None
    priorite: Optional[str] = "normale"
    adresse_chantier: Optional[str] = None
    ville_chantier: Optional[str] = None

    _normalize_date_limite = field_validator("date_limite", mode="before")(_empty_to_none)


class PortalMessageCreate(BaseModel):
    demande_id: Optional[int] = None
    contrat_id: Optional[int] = None
    message: str
    sujet: Optional[str] = None


class PortalPanierItemCreate(BaseModel):
    produit_id: int
    quantite: int = 1


class PortalPanierItemUpdate(BaseModel):
    quantite: int


class PortalCommandeCreate(BaseModel):
    adresse_livraison: Optional[str] = None
    ville_livraison: Optional[str] = None
    province_livraison: Optional[str] = "Quebec"
    code_postal_livraison: Optional[str] = None
    notes_client: Optional[str] = None


# ============================================
# DASHBOARD
# ============================================

@router.get("/dashboard")
async def portal_dashboard(client: B2bClientUser = Depends(get_current_b2b_client)):
    """Client dashboard: stats + recent activity."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cid = client.client_id
        cursor.execute("SELECT COUNT(*) as cnt FROM b2b_commandes WHERE client_company_id = %s AND statut NOT IN ('LIVREE','ANNULEE')", (cid,))
        commandes_actives = cursor.fetchone()["cnt"]
        cursor.execute("SELECT COUNT(*) as cnt FROM b2b_demandes WHERE client_id = %s AND statut IN ('NOUVELLE','EN_COURS')", (cid,))
        demandes_en_cours = cursor.fetchone()["cnt"]
        cursor.execute("SELECT COUNT(*) as cnt FROM b2b_contrats WHERE client_company_id = %s AND statut IN ('ACTIF','EN_COURS')", (cid,))
        contrats_actifs = cursor.fetchone()["cnt"]
        cursor.execute("SELECT COUNT(*) as cnt FROM b2b_messages WHERE sender_company_id != %s AND lu = FALSE AND (demande_id IN (SELECT id FROM b2b_demandes WHERE client_id = %s) OR contrat_id IN (SELECT id FROM b2b_contrats WHERE client_company_id = %s))", (cid, cid, cid))
        messages_non_lus = cursor.fetchone()["cnt"]
        return {
            "commandes_actives": commandes_actives,
            "demandes_en_cours": demandes_en_cours,
            "contrats_actifs": contrats_actifs,
            "messages_non_lus": messages_non_lus,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_dashboard error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur tableau de bord")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# CATALOGUE
# ============================================

@router.get("/catalogue")
async def portal_catalogue(
    client: B2bClientUser = Depends(get_current_b2b_client),
    search: Optional[str] = None,
    categorie: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """Browse tenant product catalogue."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        # Check if produits table exists
        cursor.execute("SELECT 1 FROM information_schema.tables WHERE table_name = 'produits' AND table_schema = current_schema()")
        if not cursor.fetchone():
            return {"items": [], "total": 0, "categories": []}
        _ensure_produits_columns(cursor, client.schema)
        where = ["1=1"]
        params = []
        if search:
            where.append("(LOWER(nom) LIKE LOWER(%s) OR LOWER(code_produit) LIKE LOWER(%s) OR LOWER(description) LIKE LOWER(%s))")
            s = f"%{search}%"
            params.extend([s, s, s])
        if categorie:
            where.append("LOWER(categorie) = LOWER(%s)")
            params.append(categorie)
        w = " AND ".join(where)
        cursor.execute(f"SELECT COUNT(*) as cnt FROM produits WHERE {w}", params)
        total = cursor.fetchone()["cnt"]
        offset = (page - 1) * per_page
        cursor.execute(f"""
            SELECT id, nom, code_produit, description, categorie, unite,
                   prix_unitaire, stock_disponible
            FROM produits WHERE {w}
            ORDER BY nom
            LIMIT %s OFFSET %s
        """, params + [per_page, offset])
        items = [_serialize(dict(r)) for r in cursor.fetchall()]
        cursor.execute("SELECT DISTINCT categorie FROM produits WHERE categorie IS NOT NULL ORDER BY categorie")
        categories = [r["categorie"] for r in cursor.fetchall()]
        return {"items": items, "total": total, "categories": categories}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_catalogue error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur catalogue")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# PANIER
# ============================================

@router.get("/panier")
async def portal_get_panier(client: B2bClientUser = Depends(get_current_b2b_client)):
    """Get or create active cart for client."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cid = client.client_id
        cursor.execute("SELECT id FROM b2b_paniers WHERE client_company_id = %s AND statut = 'actif'", (cid,))
        row = cursor.fetchone()
        if not row:
            cursor.execute("INSERT INTO b2b_paniers (client_company_id, user_id, statut) VALUES (%s, %s, 'actif') RETURNING id", (cid, client.user_id))
            row = cursor.fetchone()
            conn.commit()
        panier_id = row["id"]
        # Check produits table exists before JOIN (guard for tenants without catalogue)
        cursor.execute("SELECT 1 FROM information_schema.tables WHERE table_name = 'produits' AND table_schema = current_schema()")
        has_produits = cursor.fetchone() is not None
        if has_produits:
            _ensure_produits_columns(cursor, client.schema)
            cursor.execute("""
                SELECT pl.id, pl.produit_id, pl.quantite, pl.prix_unitaire,
                       p.nom as produit_nom, p.code_produit, p.unite
                FROM b2b_panier_lignes pl
                LEFT JOIN produits p ON pl.produit_id = p.id
                WHERE pl.panier_id = %s
                ORDER BY pl.created_at
            """, (panier_id,))
        else:
            cursor.execute("""
                SELECT pl.id, pl.produit_id, pl.quantite, pl.prix_unitaire,
                       NULL as produit_nom, NULL as code_produit, NULL as unite
                FROM b2b_panier_lignes pl
                WHERE pl.panier_id = %s
                ORDER BY pl.created_at
            """, (panier_id,))
        items = [_serialize(dict(r)) for r in cursor.fetchall()]
        sous_total = sum(float(i.get("prix_unitaire", 0) or 0) * int(i.get("quantite", 0) or 0) for i in items)
        tps = round(sous_total * TPS_RATE, 2)
        tvq = round(sous_total * TVQ_RATE, 2)
        return {
            "panier_id": panier_id,
            "items": items,
            "sous_total": round(sous_total, 2),
            "tps": tps,
            "tvq": tvq,
            "total_ttc": round(sous_total + tps + tvq, 2),
            "nb_items": len(items),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_get_panier error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur panier")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/panier/items")
async def portal_add_to_panier(body: PortalPanierItemCreate, client: B2bClientUser = Depends(get_current_b2b_client)):
    """Add item to cart or increment quantity."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cid = client.client_id
        # Verify produits table and product exist
        cursor.execute("SELECT 1 FROM information_schema.tables WHERE table_name = 'produits' AND table_schema = current_schema()")
        if not cursor.fetchone():
            raise HTTPException(status_code=400, detail="Catalogue non disponible")
        _ensure_produits_columns(cursor, client.schema)
        cursor.execute("SELECT id, prix_unitaire FROM produits WHERE id = %s", (body.produit_id,))
        produit = cursor.fetchone()
        if not produit:
            raise HTTPException(status_code=404, detail="Produit non trouve")
        prix = float(produit["prix_unitaire"] or 0)
        # Get or create cart
        cursor.execute("SELECT id FROM b2b_paniers WHERE client_company_id = %s AND statut = 'actif'", (cid,))
        panier = cursor.fetchone()
        if not panier:
            cursor.execute("INSERT INTO b2b_paniers (client_company_id, user_id, statut) VALUES (%s, %s, 'actif') RETURNING id", (cid, client.user_id))
            panier = cursor.fetchone()
            conn.commit()
        panier_id = panier["id"]
        # Check if already in cart
        cursor.execute("SELECT id, quantite FROM b2b_panier_lignes WHERE panier_id = %s AND produit_id = %s", (panier_id, body.produit_id))
        existing = cursor.fetchone()
        if existing:
            new_qty = existing["quantite"] + body.quantite
            cursor.execute("UPDATE b2b_panier_lignes SET quantite = %s WHERE id = %s", (new_qty, existing["id"]))
        else:
            cursor.execute("INSERT INTO b2b_panier_lignes (panier_id, produit_id, quantite, prix_unitaire) VALUES (%s, %s, %s, %s)",
                           (panier_id, body.produit_id, body.quantite, prix))
        conn.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_add_to_panier error: %s", exc)
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur ajout panier")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.put("/panier/items/{item_id}")
async def portal_update_panier_item(item_id: int, body: PortalPanierItemUpdate, client: B2bClientUser = Depends(get_current_b2b_client)):
    """Update cart item quantity."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        if body.quantite <= 0:
            cursor.execute("DELETE FROM b2b_panier_lignes WHERE id = %s AND panier_id IN (SELECT id FROM b2b_paniers WHERE client_company_id = %s)", (item_id, client.client_id))
        else:
            cursor.execute("UPDATE b2b_panier_lignes SET quantite = %s WHERE id = %s AND panier_id IN (SELECT id FROM b2b_paniers WHERE client_company_id = %s)", (body.quantite, item_id, client.client_id))
        conn.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_update_panier_item error: %s", exc)
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur mise a jour panier")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.delete("/panier/items/{item_id}")
async def portal_remove_from_panier(item_id: int, client: B2bClientUser = Depends(get_current_b2b_client)):
    """Remove item from cart (ownership check via client_company_id)."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("DELETE FROM b2b_panier_lignes WHERE id = %s AND panier_id IN (SELECT id FROM b2b_paniers WHERE client_company_id = %s)", (item_id, client.client_id))
        conn.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_remove_from_panier error: %s", exc)
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur suppression panier")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/panier/commander")
async def portal_commander(body: PortalCommandeCreate, client: B2bClientUser = Depends(get_current_b2b_client)):
    """Convert cart to order with TPS/TVQ."""
    conn = None
    prev_autocommit = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        # FIX P0 (round 7): forcer autocommit=False pour que SELECT FOR UPDATE
        # tienne son lock pendant toute la transaction (verif stock -> UPDATE
        # -> INSERT mouvements). En autocommit (defaut psycopg2 pool), FOR
        # UPDATE libere le lock immediatement et le check stock perd toute
        # protection contre les races concurrentes.
        try:
            prev_autocommit = conn.autocommit
        except Exception:
            prev_autocommit = None
        try:
            conn.autocommit = False
        except Exception:
            pass
        cid = client.client_id
        cursor.execute("SELECT id FROM b2b_paniers WHERE client_company_id = %s AND statut = 'actif'", (cid,))
        panier = cursor.fetchone()
        if not panier:
            raise HTTPException(status_code=400, detail="Panier vide ou introuvable")
        panier_id = panier["id"]
        # Check produits table exists before JOIN (guard for tenants without catalogue)
        cursor.execute("SELECT 1 FROM information_schema.tables WHERE table_name = 'produits' AND table_schema = current_schema()")
        has_produits = cursor.fetchone() is not None
        if has_produits:
            _ensure_produits_columns(cursor, client.schema)
            cursor.execute("SELECT pl.*, p.nom as produit_nom, p.code_produit FROM b2b_panier_lignes pl LEFT JOIN produits p ON pl.produit_id = p.id WHERE pl.panier_id = %s", (panier_id,))
        else:
            cursor.execute("SELECT pl.*, NULL as produit_nom, NULL as code_produit FROM b2b_panier_lignes pl WHERE pl.panier_id = %s", (panier_id,))
        lignes = cursor.fetchall()
        if not lignes:
            raise HTTPException(status_code=400, detail="Panier vide")

        # FIX P0: verifier la disponibilite stock AVANT de creer la commande.
        # Sans ce check, le catalogue B2B vendait du stock inexistant (survente).
        # On lock chaque produit avec FOR UPDATE pour eviter les races (2 clients
        # qui commandent simultanement le dernier item).
        # IMPORTANT: dedupliquer par produit_id pour gerer le cas ou le panier
        # contient 2 lignes du meme produit (sinon double-soustraction au
        # decrement plus bas, voir BUG round 6).
        demands_par_produit: dict[int, float] = {}
        for l in lignes:
            pid = l.get("produit_id")
            if pid:
                demands_par_produit[pid] = demands_par_produit.get(pid, 0.0) + float(l["quantite"] or 0)

        produits_locked: dict[int, dict] = {}
        if has_produits and demands_par_produit:
            insufficient = []
            for produit_id, demande_totale in demands_par_produit.items():
                cursor.execute(
                    "SELECT id, nom, stock_disponible FROM produits WHERE id = %s FOR UPDATE",
                    (produit_id,),
                )
                prod = cursor.fetchone()
                if not prod:
                    continue  # produit supprime — on laisse passer (legacy)
                produits_locked[produit_id] = dict(prod)
                stock = float(prod["stock_disponible"] or 0)
                if stock < demande_totale:
                    insufficient.append(
                        f"{prod['nom']}: demande {demande_totale}, disponible {stock}"
                    )
            if insufficient:
                raise HTTPException(
                    status_code=400,
                    detail="Stock insuffisant pour: " + " | ".join(insufficient),
                )

        # FIX P0: utiliser float() partout (pas int) — stock_disponible est
        # NUMERIC(15,2), les quantites peuvent etre fractionnaires (1.5 m, etc.).
        sous_total = sum(float(l["prix_unitaire"] or 0) * float(l["quantite"] or 0) for l in lignes)
        tps = round(sous_total * TPS_RATE, 2)
        tvq = round(sous_total * TVQ_RATE, 2)
        total_ttc = round(sous_total + tps + tvq, 2)
        # Insert with temp numero, then update with ID-based unique number
        cursor.execute("""
            INSERT INTO b2b_commandes (numero, client_company_id, adresse_livraison, ville_livraison,
                province_livraison, code_postal_livraison, sous_total, tps, tvq, total_ttc, notes_client)
            VALUES ('TEMP', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (cid, body.adresse_livraison, body.ville_livraison,
              body.province_livraison, body.code_postal_livraison,
              sous_total, tps, tvq, total_ttc, body.notes_client))
        commande_id = cursor.fetchone()["id"]
        numero = f"CMD-{datetime.now().strftime('%Y%m%d')}-{commande_id:04d}"
        cursor.execute("UPDATE b2b_commandes SET numero = %s WHERE id = %s", (numero, commande_id))
        # FIX P0: decrementer stock_disponible + creer un mouvement SORTIE
        # par ligne avec produit_id (audit trail). Verifie que mouvements_stock
        # existe avant d'inserer (defensif pour tenants legacy).
        has_mouvements = False
        if has_produits:
            cursor.execute(
                "SELECT 1 FROM information_schema.tables WHERE table_name = 'mouvements_stock' AND table_schema = current_schema()"
            )
            has_mouvements = cursor.fetchone() is not None

        # Insert des lignes commande (sans toucher au stock — fait apres en
        # une seule UPDATE par produit pour eviter la double-soustraction si
        # le panier contient plusieurs lignes du meme produit_id).
        for l in lignes:
            montant_ligne = float(l["prix_unitaire"] or 0) * float(l["quantite"] or 0)
            cursor.execute("""
                INSERT INTO b2b_commande_lignes (commande_id, produit_id, code_produit, nom_produit, quantite, prix_unitaire, montant_ligne)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (commande_id, l["produit_id"], l.get("code_produit"), l.get("produit_nom"),
                  l["quantite"], l["prix_unitaire"], montant_ligne))

        # FIX P0: decrement stock UNE FOIS par produit_id (somme des quantites)
        # + audit trail. Utilise produits_locked (capture FOR UPDATE plus haut)
        # pour calculer les valeurs avant/apres correctes.
        for produit_id, quantite_totale in demands_par_produit.items():
            if not has_produits or quantite_totale <= 0:
                continue
            cursor.execute(
                "UPDATE produits SET stock_disponible = stock_disponible - %s, "
                "updated_at = NOW() WHERE id = %s "
                "RETURNING stock_disponible",
                (quantite_totale, produit_id),
            )
            row = cursor.fetchone()
            if row and has_mouvements:
                nouveau_stock = float(row["stock_disponible"] or 0)
                quantite_avant = nouveau_stock + quantite_totale
                try:
                    cursor.execute(
                        "INSERT INTO mouvements_stock "
                        "(produit_id, type_mouvement, quantite, quantite_avant, quantite_apres, "
                        " reference_document, reference_type, motif, created_at) "
                        "VALUES (%s, 'SORTIE', %s, %s, %s, %s, 'BON_LIVRAISON', %s, NOW())",
                        (produit_id, quantite_totale, quantite_avant, nouveau_stock,
                         numero, f"Commande B2B {numero}"),
                    )
                except Exception as mvt_exc:
                    # Audit trail non bloquant — la commande passe meme si
                    # mouvements_stock a une structure differente sur tenant legacy.
                    logger.warning(
                        "audit mouvements_stock SORTIE failed for produit %s: %s",
                        produit_id, mvt_exc,
                    )

        # Mark cart as converted
        cursor.execute("UPDATE b2b_paniers SET statut = 'converti', updated_at = NOW() WHERE id = %s", (panier_id,))
        conn.commit()
        return {"commande_id": commande_id, "numero": numero, "total_ttc": total_ttc}
    except HTTPException:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise
    except Exception as exc:
        logger.error("portal_commander error: %s", exc)
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise HTTPException(status_code=500, detail="Erreur creation commande")
    finally:
        if conn:
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
# COMMANDES
# ============================================

@router.get("/commandes")
async def portal_list_commandes(client: B2bClientUser = Depends(get_current_b2b_client)):
    """List client's orders."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("""
            SELECT * FROM b2b_commandes WHERE client_company_id = %s ORDER BY created_at DESC
        """, (client.client_id,))
        rows = [_serialize(dict(r)) for r in cursor.fetchall()]
        return {"items": rows, "total": len(rows)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_list_commandes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur liste commandes")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.get("/commandes/{commande_id}")
async def portal_get_commande(commande_id: int, client: B2bClientUser = Depends(get_current_b2b_client)):
    """Get order detail with line items."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("SELECT * FROM b2b_commandes WHERE id = %s AND client_company_id = %s", (commande_id, client.client_id))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Commande non trouvee")
        commande = _serialize(dict(row))
        cursor.execute("SELECT * FROM b2b_commande_lignes WHERE commande_id = %s ORDER BY id", (commande_id,))
        commande["lignes"] = [_serialize(dict(r)) for r in cursor.fetchall()]
        return commande
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_get_commande error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur detail commande")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# DEMANDES
# ============================================

@router.get("/demandes")
async def portal_list_demandes(client: B2bClientUser = Depends(get_current_b2b_client)):
    """List client's quote requests."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("""
            SELECT d.*, (SELECT COUNT(*) FROM b2b_soumissions WHERE demande_id = d.id) as nombre_soumissions
            FROM b2b_demandes d WHERE d.client_id = %s ORDER BY d.created_at DESC
        """, (client.client_id,))
        rows = [_serialize(dict(r)) for r in cursor.fetchall()]
        return {"items": rows, "total": len(rows)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_list_demandes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur liste demandes")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/demandes")
async def portal_create_demande(body: PortalDemandeCreate, client: B2bClientUser = Depends(get_current_b2b_client)):
    """Create a quote request."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("""
            INSERT INTO b2b_demandes (client_id, titre, description, categorie, budget_estime, date_limite, priorite, adresse_chantier, ville_chantier)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
        """, (client.client_id, body.titre, body.description, body.categorie,
              body.budget_estime, body.date_limite, body.priorite,
              body.adresse_chantier, body.ville_chantier))
        new_id = cursor.fetchone()["id"]
        conn.commit()
        return {"id": new_id, "titre": body.titre}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_create_demande error: %s", exc)
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur creation demande")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.get("/demandes/{demande_id}")
async def portal_get_demande(demande_id: int, client: B2bClientUser = Depends(get_current_b2b_client)):
    """Get quote request detail with received proposals."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("SELECT * FROM b2b_demandes WHERE id = %s AND client_id = %s", (demande_id, client.client_id))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Demande non trouvee")
        demande = _serialize(dict(row))
        cursor.execute("SELECT id, montant_total, montant_ht, description, delai_execution_jours, statut, created_at FROM b2b_soumissions WHERE demande_id = %s ORDER BY created_at DESC", (demande_id,))
        demande["soumissions"] = [_serialize(dict(r)) for r in cursor.fetchall()]
        return demande
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_get_demande error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur detail demande")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# CONTRATS
# ============================================

@router.get("/contrats")
async def portal_list_contrats(client: B2bClientUser = Depends(get_current_b2b_client)):
    """List client's contracts."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("SELECT * FROM b2b_contrats WHERE client_company_id = %s ORDER BY created_at DESC", (client.client_id,))
        rows = [_serialize(dict(r)) for r in cursor.fetchall()]
        return {"items": rows, "total": len(rows)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_list_contrats error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur liste contrats")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.get("/contrats/{contrat_id}")
async def portal_get_contrat(contrat_id: int, client: B2bClientUser = Depends(get_current_b2b_client)):
    """Get contract detail."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("SELECT * FROM b2b_contrats WHERE id = %s AND client_company_id = %s", (contrat_id, client.client_id))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contrat non trouve")
        return _serialize(dict(row))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_get_contrat error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur detail contrat")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# MESSAGES
# ============================================

@router.get("/messages")
async def portal_list_messages(
    client: B2bClientUser = Depends(get_current_b2b_client),
    demande_id: Optional[int] = None,
    contrat_id: Optional[int] = None,
):
    """List messages for client's demandes/contrats."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cid = client.client_id
        where = []
        params = []
        if demande_id:
            where.append("m.demande_id = %s")
            params.append(demande_id)
            # Verify ownership
            cursor.execute("SELECT id FROM b2b_demandes WHERE id = %s AND client_id = %s", (demande_id, cid))
            if not cursor.fetchone():
                raise HTTPException(status_code=403, detail="Acces refuse")
        elif contrat_id:
            where.append("m.contrat_id = %s")
            params.append(contrat_id)
            cursor.execute("SELECT id FROM b2b_contrats WHERE id = %s AND client_company_id = %s", (contrat_id, cid))
            if not cursor.fetchone():
                raise HTTPException(status_code=403, detail="Acces refuse")
        else:
            where.append("(m.demande_id IN (SELECT id FROM b2b_demandes WHERE client_id = %s) OR m.contrat_id IN (SELECT id FROM b2b_contrats WHERE client_company_id = %s))")
            params.extend([cid, cid])
        w = " AND ".join(where) if where else "1=1"
        cursor.execute(f"SELECT m.* FROM b2b_messages m WHERE {w} ORDER BY m.created_at DESC LIMIT 100", params)
        rows = [_serialize(dict(r)) for r in cursor.fetchall()]
        return {"items": rows, "total": len(rows)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_list_messages error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur liste messages")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/messages")
async def portal_send_message(body: PortalMessageCreate, client: B2bClientUser = Depends(get_current_b2b_client)):
    """Send a message to the tenant company."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cid = client.client_id
        # Verify ownership if demande_id or contrat_id provided
        if body.demande_id:
            cursor.execute("SELECT id FROM b2b_demandes WHERE id = %s AND client_id = %s", (body.demande_id, cid))
            if not cursor.fetchone():
                raise HTTPException(status_code=403, detail="Acces refuse")
        if body.contrat_id:
            cursor.execute("SELECT id FROM b2b_contrats WHERE id = %s AND client_company_id = %s", (body.contrat_id, cid))
            if not cursor.fetchone():
                raise HTTPException(status_code=403, detail="Acces refuse")
        cursor.execute("""
            INSERT INTO b2b_messages (demande_id, contrat_id, sender_user_id, sender_company_id, message, sujet)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """, (body.demande_id, body.contrat_id, client.user_id, cid, body.message, body.sujet))
        new_id = cursor.fetchone()["id"]
        conn.commit()
        return {"id": new_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_send_message error: %s", exc)
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur envoi message")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


# ============================================
# FAVORIS
# ============================================

@router.get("/favoris")
async def portal_list_favoris(client: B2bClientUser = Depends(get_current_b2b_client)):
    """List client's favorite products."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        # Defensive guard: older tenants may not have a `produits` table at all
        cursor.execute("SELECT 1 FROM information_schema.tables WHERE table_name = 'produits' AND table_schema = current_schema()")
        if not cursor.fetchone():
            return {"items": []}
        _ensure_produits_columns(cursor, client.schema)
        cursor.execute("""
            SELECT f.id, f.produit_id, f.created_at, p.nom, p.code_produit, p.prix_unitaire, p.categorie
            FROM b2b_favoris f LEFT JOIN produits p ON f.produit_id = p.id
            WHERE f.client_company_id = %s ORDER BY f.created_at DESC
        """, (client.client_id,))
        rows = [_serialize(dict(r)) for r in cursor.fetchall()]
        return {"items": rows}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_list_favoris error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur liste favoris")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.post("/favoris/{produit_id}")
async def portal_add_favori(produit_id: int, client: B2bClientUser = Depends(get_current_b2b_client)):
    """Add product to favorites."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("SELECT id FROM b2b_favoris WHERE client_company_id = %s AND produit_id = %s", (client.client_id, produit_id))
        if cursor.fetchone():
            return {"status": "already_exists"}
        cursor.execute("INSERT INTO b2b_favoris (client_company_id, user_id, produit_id) VALUES (%s, %s, %s)", (client.client_id, client.user_id, produit_id))
        conn.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_add_favori error: %s", exc)
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur ajout favori")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()


@router.delete("/favoris/{produit_id}")
async def portal_remove_favori(produit_id: int, client: B2bClientUser = Depends(get_current_b2b_client)):
    """Remove product from favorites."""
    conn = None
    try:
        conn = db.get_conn()
        db.set_tenant(conn, client.schema)
        cursor = conn.cursor()
        _ensure_b2b_tables(cursor)
        conn.commit()
        cursor.execute("DELETE FROM b2b_favoris WHERE client_company_id = %s AND produit_id = %s", (client.client_id, produit_id))
        conn.commit()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portal_remove_favori error: %s", exc)
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur suppression favori")
    finally:
        if conn:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()
