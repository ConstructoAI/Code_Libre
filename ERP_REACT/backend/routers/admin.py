"""
ERP React - Admin Router
Super-admin endpoints: entreprises, online sessions, AI usage, CRM, messaging, updates.
Based on super_admin_ui.py (3,864 lines) — 12 tabs.
"""

import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from ..erp_auth import require_role, ErpUser, hash_password
from ..erp_models import EntrepriseAdmin, ToggleActiveRequest
from .. import erp_database as db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["Admin"])


# ============================================
# TAB 0: Entreprises list
# ============================================

@router.get("/entreprises")
async def list_entreprises(user: ErpUser = Depends(require_role("super_admin"))):
    """List all entreprises (super-admin only)."""
    try:
        entreprises = db.get_all_entreprises_admin()

        # Batch-fetch user counts for all tenants in a single connection (fixes N+1)
        schemas = []
        schema_map: dict[str, str] = {}  # schema -> slug
        for e in entreprises:
            slug = e.get("slug", "")
            if slug:
                schema = f"tenant_{slug}"
                schemas.append(schema)
                schema_map[schema] = slug
        user_counts = db.get_all_tenant_user_counts(schemas) if schemas else {}

        result = []
        for e in entreprises:
            slug = e.get("slug", "")
            schema = f"tenant_{slug}" if slug else ""
            user_count = user_counts.get(schema, 0)
            result.append(
                EntrepriseAdmin(
                    id=e["id"],
                    nom=e["nom"],
                    slug=slug,
                    email=e.get("email"),
                    representant=e.get("representant") or e.get("representant_code"),
                    telephone=e.get("telephone"),
                    adresse=e.get("adresse"),
                    subscription_status=e.get("subscription_status"),
                    plan_type=e.get("plan_type"),
                    trial_end_date=str(e["trial_end_date"]) if e.get("trial_end_date") else None,
                    created_at=str(e["created_at"]) if e.get("created_at") else None,
                    active=e.get("active", True),
                    user_count=user_count,
                ).model_dump()
            )
        return {"items": result, "total": len(result)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_entreprises error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")


# ============================================
# TENANT SCHEMA AUDIT & REPAIR (super-admin)
# ============================================

def _resolve_tenant_schema(slug_or_schema: str) -> str:
    """Accepte 'dexcoexcav_9ea27b' OU 'tenant_dexcoexcav_9ea27b' — retourne le schema.

    Valide le format AVANT toute opération DB pour éviter l'énumération
    via les messages d'erreur post-validation.
    """
    if not slug_or_schema:
        raise HTTPException(status_code=400, detail="Slug/schema requis")
    s = slug_or_schema.strip()
    schema = s if s.startswith("tenant_") else f"tenant_{s}"
    # Validation immédiate du format avant tout autre traitement
    try:
        from database_config import validate_schema_name
        if not validate_schema_name(schema):
            raise HTTPException(status_code=400, detail="Slug/schema invalide")
    except ImportError:
        # Validation locale en fallback
        import re as _re
        if not _re.match(r'^tenant_[a-z0-9_-]+$', schema) or len(schema) > 63:
            raise HTTPException(status_code=400, detail="Slug/schema invalide")
    return schema


@router.get("/tenants/{slug}/audit")
async def audit_tenant_schema(
    slug: str,
    user: ErpUser = Depends(require_role("super_admin")),
):
    """Audit le schema d'un tenant vs REFERENCE_TENANT_SCHEMA.

    Retourne:
      - tables et vues presentes / manquantes (vs reference)
      - colonnes manquantes par table existante
      - sample d'indexes / constraints manquants

    Non destructif — lecture seule.
    """
    import os
    schema = _resolve_tenant_schema(slug)
    reference = os.environ.get("REFERENCE_TENANT_SCHEMA", "tenant_constructi_2802c4")

    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()

        # 1. Le schema existe ?
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = %s) AS e",
            (schema,),
        )
        if not cursor.fetchone()["e"]:
            raise HTTPException(status_code=404, detail=f"Schema '{schema}' n'existe pas")

        # 2. Tables manquantes vs reference
        cursor.execute(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = %s AND table_type = 'BASE TABLE'
              AND table_name NOT IN (
                  SELECT table_name FROM information_schema.tables
                  WHERE table_schema = %s AND table_type = 'BASE TABLE'
              )
            ORDER BY table_name
            """,
            (reference, schema),
        )
        missing_tables = [r["table_name"] for r in cursor.fetchall()]

        # 3. Vues manquantes
        cursor.execute(
            """
            SELECT viewname FROM pg_views
            WHERE schemaname = %s
              AND viewname NOT IN (SELECT viewname FROM pg_views WHERE schemaname = %s)
            ORDER BY viewname
            """,
            (reference, schema),
        )
        missing_views = [r["viewname"] for r in cursor.fetchall()]

        # 4. Colonnes manquantes par table existante
        cursor.execute(
            """
            SELECT ref.table_name, ref.column_name
            FROM information_schema.columns ref
            WHERE ref.table_schema = %s
              AND ref.table_name IN (
                  SELECT table_name FROM information_schema.tables
                  WHERE table_schema = %s AND table_type = 'BASE TABLE'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM information_schema.columns tgt
                  WHERE tgt.table_schema = %s
                    AND tgt.table_name = ref.table_name
                    AND tgt.column_name = ref.column_name
              )
            ORDER BY ref.table_name, ref.ordinal_position
            """,
            (reference, schema, schema),
        )
        missing_cols_by_table: dict[str, list[str]] = {}
        for row in cursor.fetchall():
            missing_cols_by_table.setdefault(row["table_name"], []).append(row["column_name"])

        # 5. Compteurs globaux
        cursor.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = %s AND table_type = 'BASE TABLE') AS ref_tables,
              (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = %s AND table_type = 'BASE TABLE') AS tgt_tables,
              (SELECT COUNT(*) FROM information_schema.views WHERE table_schema = %s) AS ref_views,
              (SELECT COUNT(*) FROM information_schema.views WHERE table_schema = %s) AS tgt_views
            """,
            (reference, schema, reference, schema),
        )
        row = cursor.fetchone()

        return {
            "schema": schema,
            "reference": reference,
            "counts": {
                "tables_reference": row["ref_tables"],
                "tables_tenant": row["tgt_tables"],
                "views_reference": row["ref_views"],
                "views_tenant": row["tgt_views"],
            },
            "missing_tables": missing_tables,
            "missing_views": missing_views,
            "missing_columns": missing_cols_by_table,
            "needs_repair": bool(missing_tables or missing_views or missing_cols_by_table),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("audit_tenant_schema error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur audit schema tenant")
    finally:
        if cursor:
            cursor.close()
        conn.close()


@router.post("/tenants/{slug}/repair")
async def repair_tenant_schema_endpoint(
    slug: str,
    user: ErpUser = Depends(require_role("super_admin")),
):
    """Repare un tenant en copiant tables/vues/colonnes manquantes depuis
    REFERENCE_TENANT_SCHEMA. Idempotent.

    Retourne le nombre d'elements ajoutes + l'audit apres reparation.
    """
    import os
    schema = _resolve_tenant_schema(slug)
    reference = os.environ.get("REFERENCE_TENANT_SCHEMA", "tenant_constructi_2802c4")

    # Defense en profondeur: valider les noms de schemas (regex tenant_*)
    import re
    if not re.match(r"^tenant_[a-zA-Z0-9_]+$", schema):
        raise HTTPException(status_code=400, detail=f"Schema invalide: {schema}")
    if not re.match(r"^tenant_[a-zA-Z0-9_]+$", reference):
        raise HTTPException(status_code=500, detail="REFERENCE_TENANT_SCHEMA invalide")

    # Appelle auto_repair_tenants_startup.copy_missing_from_reference si disponible
    copied = 0
    tables_added: list[str] = []
    cols_added: dict[str, list[str]] = {}
    try:
        import sys
        import os as _os
        # auto_repair_tenants_startup.py est a la racine du repo
        _root = _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "..", "..", ".."))
        if _root not in sys.path:
            sys.path.insert(0, _root)
        from auto_repair_tenants_startup import copy_missing_from_reference  # type: ignore
        copied = copy_missing_from_reference(schema) or 0
    except Exception as exc:
        logger.warning("copy_missing_from_reference unavailable: %s", exc)

    # Ajouter les colonnes manquantes via ALTER TABLE ... ADD COLUMN (defensif).
    # On utilise information_schema du reference comme source de verite.
    conn = db.get_conn()
    cursor = None
    try:
        conn.autocommit = True
        cursor = conn.cursor()

        # Verifier que le schema existe
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = %s) AS e",
            (schema,),
        )
        if not cursor.fetchone()["e"]:
            raise HTTPException(status_code=404, detail=f"Schema '{schema}' n'existe pas")

        # Pour chaque colonne presente dans reference mais absente du tenant,
        # tenter ALTER TABLE ADD COLUMN avec data_type + nullable + default.
        cursor.execute(
            """
            SELECT ref.table_name, ref.column_name, ref.data_type,
                   ref.is_nullable, ref.column_default, ref.character_maximum_length
            FROM information_schema.columns ref
            WHERE ref.table_schema = %s
              AND ref.table_name IN (
                  SELECT table_name FROM information_schema.tables
                  WHERE table_schema = %s AND table_type = 'BASE TABLE'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM information_schema.columns tgt
                  WHERE tgt.table_schema = %s
                    AND tgt.table_name = ref.table_name
                    AND tgt.column_name = ref.column_name
              )
            ORDER BY ref.table_name, ref.ordinal_position
            """,
            (reference, schema, schema),
        )
        rows = cursor.fetchall()

        from psycopg2 import sql as pg_sql
        for r in rows:
            tbl = r["table_name"]
            col = r["column_name"]
            dtype = r["data_type"]
            nullable = (r["is_nullable"] == "YES")
            default = r["column_default"]
            char_max = r["character_maximum_length"]

            # Type text avec longueur
            if dtype in ("character varying", "character") and char_max:
                type_sql = f"{dtype}({char_max})"
            else:
                type_sql = dtype

            # Construire ALTER en toute securite via Identifier pour les noms
            # et texte pour le type (le type vient de pg, pas user input).
            default_clause = ""
            if default is not None:
                # default est deja du SQL valide depuis information_schema
                default_clause = f" DEFAULT {default}"
            null_clause = "" if nullable else ""  # On ADD COLUMN nullable pour safety

            stmt = pg_sql.SQL(
                "ALTER TABLE {sch}.{tbl} ADD COLUMN IF NOT EXISTS {col} "
            ).format(
                sch=pg_sql.Identifier(schema),
                tbl=pg_sql.Identifier(tbl),
                col=pg_sql.Identifier(col),
            )
            full_sql = stmt.as_string(conn) + type_sql + default_clause + null_clause
            try:
                cursor.execute(full_sql)
                cols_added.setdefault(tbl, []).append(col)
            except Exception as col_exc:
                logger.warning("ADD COLUMN %s.%s failed: %s", tbl, col, col_exc)

        # Re-audit apres reparation
        cursor.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = %s AND table_type = 'BASE TABLE') AS tgt_tables,
              (SELECT COUNT(*) FROM information_schema.views WHERE table_schema = %s) AS tgt_views
            """,
            (schema, schema),
        )
        post = cursor.fetchone()

        return {
            "schema": schema,
            "reference": reference,
            "copied_via_reference": copied,
            "columns_added_by_table": cols_added,
            "post_audit": {
                "tables_tenant": post["tgt_tables"],
                "views_tenant": post["tgt_views"],
            },
            "message": f"Tenant {schema} repare. Tables/vues copiees: {copied}. Colonnes ajoutees: {sum(len(v) for v in cols_added.values())}.",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("repair_tenant_schema error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur reparation schema tenant")
    finally:
        if cursor:
            cursor.close()
        conn.close()


# ============================================
# RESET MOTS DE PASSE (super-admin)
# ============================================

class _ResetPasswordsBody(BaseModel):
    """Corps de la requete de reset des mots de passe pour un tenant.

    Les 3 champs sont optionnels — on ne reset que ce qui est fourni.
    Au moins un champ doit etre present.
    """
    entreprise_password: Optional[str] = None
    user_email: Optional[str] = None
    user_password: Optional[str] = None


@router.post("/tenants/{slug}/reset-passwords")
async def reset_tenant_passwords(
    slug: str,
    body: _ResetPasswordsBody,
    user: ErpUser = Depends(require_role("super_admin")),
):
    """Reset du mot de passe login entreprise et/ou d'un utilisateur du
    tenant. Super-admin only.

    - `entreprise_password`: nouveau mdp login niveau 1 (table public.entreprises)
    - `user_email` + `user_password`: nouveau mdp d'un user specifique du tenant
      (table <schema>.users). Les deux doivent etre fournis ensemble.

    Retourne un recap des actions executees.
    """
    schema = _resolve_tenant_schema(slug)

    # Validation: au moins une action demandee
    if not body.entreprise_password and not (body.user_email and body.user_password):
        raise HTTPException(
            status_code=400,
            detail="Fournir au moins `entreprise_password` OU (`user_email` + `user_password`)",
        )
    if (body.user_email and not body.user_password) or (body.user_password and not body.user_email):
        raise HTTPException(
            status_code=400,
            detail="`user_email` et `user_password` doivent etre fournis ensemble",
        )

    # Validation longueurs
    if body.entreprise_password and len(body.entreprise_password) < 8:
        raise HTTPException(status_code=400, detail="Mot de passe entreprise: min 8 caracteres")
    if body.user_password and len(body.user_password) < 6:
        raise HTTPException(status_code=400, detail="Mot de passe user: min 6 caracteres")

    results = {
        "schema": schema,
        "entreprise_password_reset": False,
        "user_password_reset": False,
        "user_email": body.user_email,
    }

    # ---- 1. Reset mot de passe entreprise (public.entreprises) ----
    if body.entreprise_password:
        conn = db.get_conn()
        cursor = None
        try:
            cursor = conn.cursor()
            cursor.execute("SET search_path TO public")
            # Resolve entreprise par slug (accepte tenant_xxx ou juste xxx)
            short_slug = schema.replace("tenant_", "", 1)
            pw_hash = hash_password(body.entreprise_password)
            cursor.execute(
                "UPDATE entreprises SET password_hash = %s, updated_at = CURRENT_TIMESTAMP "
                "WHERE slug = %s OR slug = %s RETURNING id, nom, email",
                (pw_hash, short_slug, schema),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Entreprise non trouvee: {slug}")
            conn.commit()
            results["entreprise_password_reset"] = True
            results["entreprise_id"] = row["id"]
            results["entreprise_nom"] = row["nom"]
            results["entreprise_email"] = row.get("email")
            logger.info(
                "[ADMIN RESET] entreprise password reset: id=%s slug=%s by super_admin=%s",
                row["id"], short_slug, user.user_id,
            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("reset entreprise password error: %s", exc)
            try:
                conn.rollback()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="Erreur reset mot de passe entreprise")
        finally:
            if cursor:
                cursor.close()
            conn.close()

    # ---- 2. Reset mot de passe user dans le schema tenant ----
    if body.user_email and body.user_password:
        conn = db.get_conn()
        cursor = None
        try:
            db.set_tenant(conn, schema)
            cursor = conn.cursor()
            # Lookup user par email (case-insensitive) OU par username
            pw_hash = hash_password(body.user_password)
            cursor.execute(
                "UPDATE users SET password_hash = %s "
                "WHERE LOWER(email) = LOWER(%s) OR LOWER(username) = LOWER(%s) "
                "RETURNING id, username, email, full_name, role, is_admin",
                (pw_hash, body.user_email, body.user_email),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(
                    status_code=404,
                    detail=f"Utilisateur '{body.user_email}' non trouve dans {schema}",
                )
            conn.commit()
            results["user_password_reset"] = True
            results["user_id"] = row["id"]
            results["user_username"] = row["username"]
            results["user_full_name"] = row.get("full_name")
            results["user_role"] = row.get("role")
            results["user_is_admin"] = row.get("is_admin", False)
            logger.info(
                "[ADMIN RESET] tenant user password reset: schema=%s user_id=%s username=%s by super_admin=%s",
                schema, row["id"], row["username"], user.user_id,
            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("reset tenant user password error: %s", exc)
            try:
                conn.rollback()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="Erreur reset mot de passe utilisateur")
        finally:
            if cursor:
                cursor.close()
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()

    return results


@router.post("/tenants/repair-all-known-fixes")
async def repair_all_tenants_known_fixes(
    user: ErpUser = Depends(require_role("super_admin")),
):
    """Applique les known schema fixes (CHECK constraints, PRIMARY KEY,
    NOT NULL drift) a TOUS les tenants actifs, sans attendre un restart.

    Utile apres avoir deploye un nouveau fix schema pour qu'il soit
    applique immediatement partout, pas seulement au prochain boot des
    workers Render.

    Retourne un recap {tenant_schema: nb_fixes_appliques}.
    """
    try:
        import sys
        import os as _os
        _root = _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "..", "..", ".."))
        if _root not in sys.path:
            sys.path.insert(0, _root)
        from auto_repair_tenants_startup import apply_known_fixes_to_all_tenants  # type: ignore
    except Exception as exc:
        logger.error("apply_known_fixes_to_all_tenants import failed: %s", exc)
        raise HTTPException(status_code=500, detail="Module de reparation indisponible")

    try:
        results = apply_known_fixes_to_all_tenants()
        total_tenants = len(results)
        total_fixes = sum(results.values())
        return {
            "message": f"Known fixes appliques sur {total_tenants} tenant(s), {total_fixes} fix(es) au total",
            "tenants_processed": total_tenants,
            "total_fixes_applied": total_fixes,
            "details": results,
        }
    except Exception as exc:
        logger.error("repair_all_tenants_known_fixes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors de la reparation globale")


@router.put("/entreprises/{entreprise_id}/toggle")
async def toggle_entreprise(
    entreprise_id: int,
    body: ToggleActiveRequest,
    user: ErpUser = Depends(require_role("super_admin")),
):
    """Activate or deactivate an entreprise."""
    try:
        success = db.toggle_entreprise_active(entreprise_id, body.active)
        if not success:
            raise HTTPException(status_code=500, detail="Erreur lors de la modification")
        status = "activee" if body.active else "desactivee"
        return {"message": f"Entreprise {status} avec succes"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("toggle_entreprise error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")


@router.get("/stats")
async def admin_stats(user: ErpUser = Depends(require_role("super_admin"))):
    """Get global admin statistics — enriched dashboard."""
    conn = db.get_conn()
    cursor = None
    try:
        entreprises = db.get_all_entreprises_admin()
        total = len(entreprises)
        active = sum(1 for e in entreprises if e.get("active", False))

        # Monthly signup trend (last 12 months)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COUNT(*) as signups "
            "FROM public.entreprises "
            "WHERE created_at >= CURRENT_DATE - INTERVAL '12 months' "
            f"{db._TEST_EMAIL_FILTER} "
            "GROUP BY TO_CHAR(created_at, 'YYYY-MM') "
            "ORDER BY month"
        )
        signup_trend = [{"month": r["month"], "signups": r["signups"]} for r in cursor.fetchall()]

        # New this month
        cursor.execute(
            "SELECT COUNT(*) as new_this_month FROM public.entreprises "
            "WHERE EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE) "
            "AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE) "
            f"{db._TEST_EMAIL_FILTER}"
        )
        new_month = cursor.fetchone()
        new_this_month = new_month["new_this_month"] if new_month else 0

        # Subscription status distribution
        cursor.execute(
            "SELECT COALESCE(subscription_status, 'unknown') as status, COUNT(*) as count "
            f"FROM public.entreprises WHERE TRUE {db._TEST_EMAIL_FILTER} GROUP BY subscription_status ORDER BY count DESC"
        )
        sub_distribution = [{"status": r["status"], "count": r["count"]} for r in cursor.fetchall()]

        # Revenue by client (top 15 from ai_prepaid_credits)
        cursor.execute(
            "SELECT e.nom, apc.total_charged_usd, apc.total_consumed_usd, apc.balance_usd, apc.charges_count "
            "FROM public.ai_prepaid_credits apc "
            "JOIN public.entreprises e ON apc.entreprise_id = e.id "
            "WHERE apc.total_charged_usd > 0 "
            "ORDER BY apc.total_charged_usd DESC LIMIT 15"
        )
        revenue_clients = []
        for r in cursor.fetchall():
            revenue_clients.append({
                "nom": r["nom"],
                "charged": round(float(r["total_charged_usd"] or 0), 2),
                "consumed": round(float(r["total_consumed_usd"] or 0), 2),
                "balance": round(float(r["balance_usd"] or 0), 2),
                "charges": r["charges_count"] or 0,
            })

        # Total MRR from Stripe subscriptions
        cursor.execute(
            "SELECT COUNT(*) as total_subs, "
            "COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as active_subs "
            f"FROM public.entreprises WHERE stripe_subscription_id IS NOT NULL {db._TEST_EMAIL_FILTER}"
        )
        sub_row = cursor.fetchone()

        return {
            "total_entreprises": total,
            "active_entreprises": active,
            "inactive_entreprises": total - active,
            "new_this_month": new_this_month,
            "total_subscriptions": sub_row["total_subs"] if sub_row else 0,
            "active_subscriptions": sub_row["active_subs"] if sub_row else 0,
            "signup_trend": signup_trend,
            "subscription_distribution": sub_distribution,
            "revenue_clients": revenue_clients,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin_stats error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor:
            cursor.close()
        conn.close()


# ============================================
# TAB 3: Online Sessions
# ============================================

@router.get("/online")
async def get_online_sessions(
    user: ErpUser = Depends(require_role("super_admin")),
    threshold_minutes: int = Query(30, ge=5, le=120),
):
    """Get currently online companies and sessions."""
    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()

        # Check if active_sessions table exists
        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'active_sessions')"
        )
        if not cursor.fetchone().get("exists", False):
            return {"stats": {"erp_online": 0, "experts_online": 0, "total_sessions": 0}, "sessions": [], "by_entreprise": [], "login_trend": [], "peak_hours": [], "top_users": []}

        cursor.execute(
            "SELECT COUNT(DISTINCT CASE WHEN product_type = 'ERP' OR product_type IS NULL "
            "  THEN entreprise_id END) as erp_online, "
            "COUNT(DISTINCT CASE WHEN product_type = 'EXPERTS_IA' "
            "  THEN entreprise_id END) as experts_online, "
            "COUNT(*) as total_sessions "
            "FROM public.active_sessions "
            "WHERE last_activity >= CURRENT_TIMESTAMP - make_interval(mins => %s)",
            (threshold_minutes,),
        )
        row = cursor.fetchone()
        stats = {
            "erp_online": row["erp_online"] if row else 0,
            "experts_online": row["experts_online"] if row else 0,
            "total_sessions": row["total_sessions"] if row else 0,
        }

        # Get session details
        cursor.execute(
            "SELECT session_id, user_id, username, login_time, last_activity, "
            "entreprise_id, entreprise_nom, product_type "
            "FROM public.active_sessions "
            "WHERE last_activity >= CURRENT_TIMESTAMP - make_interval(mins => %s) "
            "ORDER BY last_activity DESC",
            (threshold_minutes,),
        )
        sessions = []
        for s in cursor.fetchall():
            sessions.append({
                "session_id": s.get("session_id"),
                "username": s.get("username", ""),
                "entreprise_nom": s.get("entreprise_nom", ""),
                "product_type": s.get("product_type", "ERP"),
                "login_time": str(s["login_time"]) if s.get("login_time") else None,
                "derniere_activite": str(s["last_activity"]) if s.get("last_activity") else None,
            })

        # Sessions by entreprise (pie chart)
        cursor.execute(
            "SELECT COALESCE(entreprise_nom, 'Inconnu') as nom, COUNT(*) as sessions "
            "FROM public.active_sessions "
            "WHERE last_activity >= CURRENT_TIMESTAMP - make_interval(mins => %s) "
            "GROUP BY entreprise_nom ORDER BY sessions DESC",
            (threshold_minutes,),
        )
        by_entreprise = [{"nom": r["nom"], "sessions": r["sessions"]} for r in cursor.fetchall()]

        # Login activity last 30 days (line chart)
        cursor.execute(
            "SELECT DATE(login_time) as day, COUNT(*) as logins, "
            "COUNT(DISTINCT entreprise_id) as unique_companies "
            "FROM public.active_sessions "
            "WHERE login_time >= CURRENT_DATE - INTERVAL '30 days' "
            "GROUP BY DATE(login_time) ORDER BY day"
        )
        login_trend = []
        for r in cursor.fetchall():
            login_trend.append({
                "date": r["day"].strftime("%d %b") if r["day"] else "",
                "logins": r["logins"],
                "companies": r["unique_companies"],
            })

        # Peak hours distribution (bar chart)
        cursor.execute(
            "SELECT EXTRACT(HOUR FROM login_time)::int as hour, COUNT(*) as logins "
            "FROM public.active_sessions "
            "WHERE login_time >= CURRENT_DATE - INTERVAL '30 days' "
            "GROUP BY EXTRACT(HOUR FROM login_time) ORDER BY hour"
        )
        peak_hours = [{"hour": f"{r['hour']}h", "logins": r["logins"]} for r in cursor.fetchall()]

        # Most active users (top 10)
        cursor.execute(
            "SELECT username, entreprise_nom, COUNT(*) as sessions, "
            "MAX(last_activity) as last_seen "
            "FROM public.active_sessions "
            "WHERE login_time >= CURRENT_DATE - INTERVAL '30 days' "
            "GROUP BY username, entreprise_nom "
            "ORDER BY sessions DESC LIMIT 10"
        )
        top_users = []
        for r in cursor.fetchall():
            top_users.append({
                "username": r["username"] or "",
                "entreprise_nom": r["entreprise_nom"] or "",
                "sessions": r["sessions"],
                "last_seen": str(r["last_seen"]) if r.get("last_seen") else None,
            })

        return {
            "stats": stats, "sessions": sessions,
            "by_entreprise": by_entreprise,
            "login_trend": login_trend,
            "peak_hours": peak_hours,
            "top_users": top_users,
        }
    except Exception as exc:
        logger.error("get_online_sessions error: %s", exc)
        return {
            "stats": {"erp_online": 0, "experts_online": 0, "total_sessions": 0},
            "sessions": [], "by_entreprise": [], "login_trend": [], "peak_hours": [], "top_users": [],
        }
    finally:
        if cursor:
            cursor.close()
        conn.close()


# ============================================
# TAB 4: AI Usage
# ============================================

@router.get("/ai-usage")
async def get_ai_usage(
    user: ErpUser = Depends(require_role("super_admin")),
    month: Optional[int] = None,
    year: Optional[int] = None,
):
    """Get AI usage statistics across all companies — financial dashboard."""
    now = datetime.now()
    m = month or now.month
    y = year or now.year

    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()

        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'ai_usage_tracking')"
        )
        exists = cursor.fetchone()
        if not exists or not exists.get("exists", False):
            return {
                "month": m, "year": y,
                "total_cost": 0, "total_requests": 0, "avg_tokens": 0,
                "anthropic_cost": 0, "total_revenue": 0, "profit": 0, "active_clients": 0,
                "by_company": [], "daily_trend": [], "by_feature": [],
            }

        # Monthly totals from usage tracking
        cursor.execute(
            "SELECT COALESCE(SUM(cost_usd), 0) as total_cost, "
            "COUNT(*) as total_requests, "
            "COALESCE(AVG(input_tokens + output_tokens), 0) as avg_tokens, "
            "COUNT(DISTINCT tenant_slug) as active_clients "
            "FROM public.ai_usage_tracking "
            "WHERE EXTRACT(MONTH FROM created_at) = %s "
            "AND EXTRACT(YEAR FROM created_at) = %s",
            (m, y),
        )
        totals = cursor.fetchone()
        total_cost = round(float(totals["total_cost"]), 4) if totals else 0
        anthropic_cost = round(total_cost / 1.30, 4)
        profit = round(total_cost - anthropic_cost, 4)

        # By company with enterprise details + billing
        cursor.execute(
            "SELECT u.tenant_slug, "
            "COALESCE(SUM(u.cost_usd), 0) as monthly_cost, "
            "COUNT(*) as total_requests, "
            "COALESCE(SUM(u.input_tokens + u.output_tokens), 0) as total_tokens, "
            "e.nom as entreprise_nom, "
            "e.email as entreprise_email, "
            "apc.balance_usd, "
            "apc.total_charged_usd, "
            "apc.total_consumed_usd, "
            "apc.charges_count "
            "FROM public.ai_usage_tracking u "
            "LEFT JOIN public.entreprises e "
            "  ON e.slug = CONCAT('tenant_', u.tenant_slug) "
            "LEFT JOIN public.ai_prepaid_credits apc "
            "  ON apc.tenant_slug = u.tenant_slug "
            "WHERE EXTRACT(MONTH FROM u.created_at) = %s "
            "AND EXTRACT(YEAR FROM u.created_at) = %s "
            "GROUP BY u.tenant_slug, e.nom, e.email, "
            "  apc.balance_usd, apc.total_charged_usd, apc.total_consumed_usd, apc.charges_count "
            "ORDER BY SUM(u.cost_usd) DESC",
            (m, y),
        )
        by_company = []
        for row in cursor.fetchall():
            mc = round(float(row["monthly_cost"]), 4)
            ac = round(mc / 1.30, 4)
            by_company.append({
                "company_id": row["tenant_slug"] or "unknown",
                "entreprise_nom": row["entreprise_nom"] or row["tenant_slug"] or "—",
                "entreprise_email": row["entreprise_email"] or "",
                "monthly_cost": mc,
                "anthropic_cost": ac,
                "profit": round(mc - ac, 4),
                "total_requests": row["total_requests"],
                "total_tokens": row["total_tokens"],
                "balance_usd": round(float(row["balance_usd"] or 0), 2),
                "total_charged_usd": round(float(row["total_charged_usd"] or 0), 2),
                "total_consumed_usd": round(float(row["total_consumed_usd"] or 0), 2),
                "charges_count": row["charges_count"] or 0,
            })

        # Daily trend for chart
        cursor.execute(
            "SELECT DATE(created_at) as day, "
            "COALESCE(SUM(cost_usd), 0) as daily_cost, "
            "COUNT(*) as daily_requests "
            "FROM public.ai_usage_tracking "
            "WHERE EXTRACT(MONTH FROM created_at) = %s "
            "AND EXTRACT(YEAR FROM created_at) = %s "
            "GROUP BY DATE(created_at) "
            "ORDER BY DATE(created_at)",
            (m, y),
        )
        daily_trend = []
        for row in cursor.fetchall():
            dc = round(float(row["daily_cost"]), 4)
            daily_trend.append({
                "date": row["day"].strftime("%d %b"),
                "cost": dc,
                "anthropic": round(dc / 1.30, 4),
                "profit": round(dc - dc / 1.30, 4),
                "requests": row["daily_requests"],
            })

        # By feature for pie chart
        cursor.execute(
            "SELECT feature, "
            "COALESCE(SUM(cost_usd), 0) as cost, "
            "COUNT(*) as requests "
            "FROM public.ai_usage_tracking "
            "WHERE EXTRACT(MONTH FROM created_at) = %s "
            "AND EXTRACT(YEAR FROM created_at) = %s "
            "GROUP BY feature "
            "ORDER BY SUM(cost_usd) DESC",
            (m, y),
        )
        by_feature = []
        for row in cursor.fetchall():
            by_feature.append({
                "feature": row["feature"] or "unknown",
                "cost": round(float(row["cost"]), 4),
                "requests": row["requests"],
            })

        # Total revenue from Stripe (all time for current active tenants)
        cursor.execute(
            "SELECT COALESCE(SUM(total_charged_usd), 0) as total_revenue "
            "FROM public.ai_prepaid_credits"
        )
        rev_row = cursor.fetchone()
        total_revenue = round(float(rev_row["total_revenue"]), 2) if rev_row else 0

        return {
            "month": m,
            "year": y,
            "total_cost": total_cost,
            "anthropic_cost": anthropic_cost,
            "profit": profit,
            "total_revenue": total_revenue,
            "total_requests": totals["total_requests"] if totals else 0,
            "avg_tokens": round(float(totals["avg_tokens"]), 0) if totals else 0,
            "active_clients": totals["active_clients"] if totals else 0,
            "by_company": by_company,
            "daily_trend": daily_trend,
            "by_feature": by_feature,
        }
    except Exception as exc:
        logger.error("get_ai_usage error: %s", exc)
        return {
            "month": m, "year": y,
            "total_cost": 0, "total_requests": 0, "avg_tokens": 0,
            "anthropic_cost": 0, "total_revenue": 0, "profit": 0, "active_clients": 0,
            "by_company": [], "daily_trend": [], "by_feature": [],
        }
    finally:
        if cursor:
            cursor.close()
        conn.close()


# ============================================
# TAB 9: Program Updates
# ============================================

class ProgramUpdateCreate(BaseModel):
    message: str
    update_type: str = "feature"


@router.get("/updates")
async def get_program_updates(user: ErpUser = Depends(require_role("super_admin"))):
    """Get program update announcements."""
    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'broadcast_messages')"
        )
        exists = cursor.fetchone()
        if not exists or not exists.get("exists", False):
            return {"items": []}

        cursor.execute(
            "SELECT id, message, message_type, created_at, is_active "
            "FROM public.broadcast_messages "
            "ORDER BY created_at DESC LIMIT 50"
        )
        items = []
        for row in cursor.fetchall():
            items.append({
                "id": row["id"],
                "message": row["message"],
                "type": row.get("message_type", "info"),
                "created_at": str(row["created_at"]) if row.get("created_at") else None,
                "is_active": row.get("is_active", True),
            })
        return {"items": items}
    except Exception as exc:
        logger.error("get_program_updates error: %s", exc)
        return {"items": []}
    finally:
        if cursor:
            cursor.close()
        conn.close()


@router.post("/updates")
async def create_program_update(
    body: ProgramUpdateCreate,
    user: ErpUser = Depends(require_role("super_admin")),
):
    """Create a new program update announcement."""
    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO public.broadcast_messages (message, message_type, created_by, is_active, created_at) "
            "VALUES (%s, %s, %s, TRUE, CURRENT_TIMESTAMP) RETURNING id",
            (body.message, body.update_type, user.display_name or str(user.user_id)),
        )
        row = cursor.fetchone()
        conn.commit()
        return {"id": row["id"] if row else 0, "message": "Mise à jour créée"}
    except Exception as exc:
        logger.error("create_program_update error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur lors de la création")
    finally:
        if cursor:
            cursor.close()
        conn.close()


# ============ Representants ============

def _ensure_representants_table(cursor):
    """Create representants table + ensure entreprises.representant_code column exists.

    Why: assign/update/delete routes reference `representant_code` on
    public.entreprises but only `representant` was ever ALTER-added. Without
    the column, those routes crash with "column representant_code does not
    exist". Lazy-create here so all representant routes share one path.
    """
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS public.representants (
            id SERIAL PRIMARY KEY,
            nom TEXT NOT NULL,
            email TEXT,
            telephone TEXT,
            actif BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("ALTER TABLE public.entreprises ADD COLUMN IF NOT EXISTS representant TEXT")
    cursor.execute("ALTER TABLE public.entreprises ADD COLUMN IF NOT EXISTS representant_code TEXT")


def _force_public_schema(cursor):
    """Pool connections run in AUTOCOMMIT + may have a tenant search_path
    set from a previous request. Force `public` before touching the
    cross-tenant representants table so writes land where reads look."""
    cursor.execute("SET search_path TO public")


@router.get("/representants")
async def list_representants(user: ErpUser = Depends(require_role("super_admin"))):
    """List all representants."""
    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        _force_public_schema(cursor)
        _ensure_representants_table(cursor)
        conn.commit()
        cursor.execute("SELECT * FROM public.representants ORDER BY nom")
        return {"items": cursor.fetchall()}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_representants error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        conn.close()

_REP_NOM_MAX = 100
_REP_EMAIL_MAX = 255
_REP_TEL_MAX = 30


def _clean_str(value, max_len: int, field: str, *, required: bool = False) -> str | None:
    """Coerce value to a bounded, stripped string (or None if optional & empty).

    Guards against non-string inputs (int, list, None) that would crash on
    .strip() — FastAPI accepts `dict` annotation without per-field typing,
    so the client can send e.g. `{"nom": 123}` and reach this code.
    """
    if value is None:
        if required:
            raise HTTPException(status_code=400, detail=f"Le champ '{field}' est requis")
        return None
    if not isinstance(value, str):
        raise HTTPException(status_code=400, detail=f"Le champ '{field}' doit être une chaîne")
    s = value.strip()
    if not s:
        if required:
            raise HTTPException(status_code=400, detail=f"Le champ '{field}' est requis")
        return None
    if len(s) > max_len:
        raise HTTPException(status_code=400, detail=f"Champ '{field}' trop long (max {max_len})")
    return s


def _validate_rep_fields(body: dict) -> tuple[str, str | None, str | None]:
    """Extract + type-check + bound-check representant fields. Raises 400 on invalid."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Corps de requête invalide")
    nom = _clean_str(body.get("nom"), _REP_NOM_MAX, "nom", required=True)
    email = _clean_str(body.get("email"), _REP_EMAIL_MAX, "email")
    tel = _clean_str(body.get("telephone"), _REP_TEL_MAX, "telephone")
    # _clean_str returns Optional[str]; nom is required so it's str at runtime
    assert nom is not None
    return nom, email, tel


@router.post("/representants")
async def create_representant(body: dict, user: ErpUser = Depends(require_role("super_admin"))):
    """Create a new representant."""
    logger.info("[create_representant] user=%s body_keys=%s", getattr(user, 'username', '?'), list(body.keys()) if isinstance(body, dict) else type(body).__name__)
    nom, email, tel = _validate_rep_fields(body)
    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        _force_public_schema(cursor)
        _ensure_representants_table(cursor)
        cursor.execute(
            "INSERT INTO public.representants (nom, email, telephone) VALUES (%s, %s, %s) RETURNING id",
            (nom, email, tel),
        )
        row = cursor.fetchone()
        if not row:
            conn.rollback()
            logger.error("[create_representant] INSERT returned no row for nom=%s", nom)
            raise HTTPException(status_code=500, detail="Erreur lors de la création")
        conn.commit()
        new_id = row["id"]
        # Verify persistence — confirms autocommit + schema are aligned
        cursor.execute("SELECT id, nom FROM public.representants WHERE id = %s", (new_id,))
        verify = cursor.fetchone()
        logger.info("[create_representant] created id=%s nom=%s verify=%s", new_id, nom, verify)
        return {"id": new_id, "message": "Représentant créé"}
    except HTTPException:
        raise
    except Exception as exc:
        # Log full detail server-side; return a generic message to client.
        logger.error("create_representant error: %s", exc, exc_info=True)
        try: conn.rollback()
        except Exception: pass
        raise HTTPException(status_code=500, detail="Erreur lors de la création du représentant")
    finally:
        if cursor: cursor.close()
        conn.close()

@router.put("/representants/{rep_id}")
async def update_representant(rep_id: int, body: dict, user: ErpUser = Depends(require_role("super_admin"))):
    """Update a representant."""
    logger.info("[update_representant] id=%s keys=%s", rep_id, list(body.keys()) if isinstance(body, dict) else type(body).__name__)
    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        _force_public_schema(cursor)
        _ensure_representants_table(cursor)
        # Get old name for updating entreprises
        cursor.execute("SELECT nom FROM public.representants WHERE id = %s", (rep_id,))
        old = cursor.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Représentant introuvable")
        old_nom = old["nom"]

        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="Corps de requête invalide")
        # Per-field length limits to prevent oversized payloads
        _max_len = {"nom": _REP_NOM_MAX, "email": _REP_EMAIL_MAX, "telephone": _REP_TEL_MAX}
        set_parts = []
        values = []
        for key in ("nom", "email", "telephone", "actif"):
            if key in body:
                set_parts.append(f"{key} = %s")
                raw = body[key]
                if key == "actif":
                    # Accept bool or stringly-typed truthy values
                    if isinstance(raw, bool):
                        val = raw
                    elif isinstance(raw, str):
                        val = raw.strip().lower() in ("true", "1", "yes")
                    else:
                        val = bool(raw)
                else:
                    # nom / email / telephone — type-check + length + strip
                    val = _clean_str(raw, _max_len[key], key, required=(key == "nom"))
                values.append(val)
        if not set_parts:
            raise HTTPException(status_code=400, detail="Aucun champ à modifier")
        values.append(rep_id)
        cursor.execute(f"UPDATE public.representants SET {', '.join(set_parts)} WHERE id = %s", values)

        # If name changed, update all entreprises referencing the old name
        new_nom = body.get("nom", "").strip()
        if new_nom and new_nom != old_nom:
            cursor.execute(
                "UPDATE public.entreprises SET representant = %s, representant_code = %s WHERE representant = %s OR representant_code = %s",
                (new_nom, new_nom, old_nom, old_nom),
            )
        conn.commit()
        return {"message": "Représentant modifié"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_representant error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        conn.close()

@router.delete("/representants/{rep_id}")
async def delete_representant(rep_id: int, user: ErpUser = Depends(require_role("super_admin"))):
    """Delete a representant and clear references."""
    logger.info("[delete_representant] id=%s", rep_id)
    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        _force_public_schema(cursor)
        _ensure_representants_table(cursor)
        cursor.execute("SELECT nom FROM public.representants WHERE id = %s", (rep_id,))
        old = cursor.fetchone()
        if not old:
            raise HTTPException(status_code=404, detail="Représentant introuvable")
        # Clear references in entreprises
        cursor.execute(
            "UPDATE public.entreprises SET representant = NULL, representant_code = NULL WHERE representant = %s OR representant_code = %s",
            (old["nom"], old["nom"]),
        )
        cursor.execute("DELETE FROM public.representants WHERE id = %s", (rep_id,))
        conn.commit()
        return {"message": "Représentant supprimé"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_representant error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        conn.close()

@router.put("/entreprises/{entreprise_id}/representant")
async def assign_representant(entreprise_id: int, body: dict, user: ErpUser = Depends(require_role("super_admin"))):
    """Assign or clear a representant on an entreprise."""
    rep_nom = (body.get("representant") or "").strip() or None
    logger.info("[assign_representant] entreprise_id=%s rep=%s", entreprise_id, rep_nom)
    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()
        _force_public_schema(cursor)
        _ensure_representants_table(cursor)
        cursor.execute(
            "UPDATE public.entreprises SET representant = %s, representant_code = %s WHERE id = %s",
            (rep_nom, rep_nom, entreprise_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Entreprise introuvable")
        conn.commit()
        return {"message": "Représentant assigné"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("assign_representant error: %s", exc)
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erreur")
    finally:
        if cursor: cursor.close()
        conn.close()


# ============================================
# TAB: Finances (P&L)
# ============================================

RENDER_MONTHLY_COST = 434.67
OWNER_NAME = "Sylvain Leduc"
REP_COMMISSION_RATE = 0.40
CORPORATE_TAX_RATE = 0.265  # Federal 15% + Quebec 11.5%
ERP_MONTHLY_PRICE = 79.99   # Prix unique pour tous les abonnements


@router.get("/finances")
async def get_finances(
    user: ErpUser = Depends(require_role("super_admin")),
    month: Optional[int] = None,
    year: Optional[int] = None,
):
    """Financial summary — revenue, expenses, commissions, profit."""
    now = datetime.now()
    m = month or now.month
    y = year or now.year

    conn = db.get_conn()
    cursor = None
    try:
        cursor = conn.cursor()

        # Count all entreprises for context
        cursor.execute(f"SELECT COUNT(*) as total FROM public.entreprises WHERE TRUE {db._TEST_EMAIL_FILTER}")
        total_entreprises = cursor.fetchone()["total"]

        # 1. Subscription revenue — only entreprises with REAL Stripe subscription active
        #    Fixed price of 79.99$/month for all active Stripe subscribers
        subscriptions = []
        cursor.execute(
            "SELECT e.id as eid, e.nom, e.email, e.plan_type, "
            "COALESCE(e.representant, e.representant_code) as representant, "
            "e.subscription_status, e.created_at "
            "FROM public.entreprises e "
            "WHERE e.subscription_status = 'active' "
            "AND e.stripe_subscription_id IS NOT NULL "
            f"{db._TEST_EMAIL_FILTER} "
            "ORDER BY e.nom"
        )
        for row in cursor.fetchall():
            subscriptions.append({
                "eid": row["eid"],
                "nom": row["nom"],
                "email": row.get("email", ""),
                "plan_type": "Constructo AI",
                "representant": row.get("representant"),
                "price_monthly": ERP_MONTHLY_PRICE,
                "plan_name": "Constructo AI",
                "created_at": str(row["created_at"]) if row.get("created_at") else None,
            })

        # Calculate subscription revenue and commissions
        subscription_revenue = 0.0
        commissions_total = 0.0
        commissions_map: dict = {}
        subscriptions_detail = []

        for s in subscriptions:
            price = float(s.get("price_monthly") or 0)
            rep = (s.get("representant") or "").strip()
            nom = s.get("nom", "")
            plan = s.get("plan_name") or s.get("plan_type") or "ERP"

            subscription_revenue += price

            if rep and rep.lower() != OWNER_NAME.lower():
                commission = round(price * REP_COMMISSION_RATE, 2)
            else:
                commission = 0.0

            commissions_total += commission

            subscriptions_detail.append({
                "nom": nom,
                "plan_type": plan,
                "price_monthly": round(price, 2),
                "representant": rep or "\u2014",
                "commission": commission,
                "net": round(price - commission, 2),
            })

            if rep:
                if rep not in commissions_map:
                    commissions_map[rep] = {"clients": 0, "revenue": 0.0, "commission": 0.0}
                commissions_map[rep]["clients"] += 1
                commissions_map[rep]["revenue"] += price
                commissions_map[rep]["commission"] += commission

        subscription_revenue = round(subscription_revenue, 2)
        commissions_total = round(commissions_total, 2)

        # 2. AI revenue for the selected month
        ai_revenue = 0.0
        anthropic_cost = 0.0
        cursor.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = 'ai_usage_tracking')"
        )
        has_ai = cursor.fetchone()
        if has_ai and has_ai.get("exists", False):
            cursor.execute(
                "SELECT COALESCE(SUM(cost_usd), 0) as ai_revenue "
                "FROM public.ai_usage_tracking "
                "WHERE EXTRACT(MONTH FROM created_at) = %s "
                "AND EXTRACT(YEAR FROM created_at) = %s",
                (m, y),
            )
            ai_row = cursor.fetchone()
            ai_revenue = round(float(ai_row["ai_revenue"]), 2) if ai_row else 0
            anthropic_cost = round(ai_revenue / 1.30, 2) if ai_revenue > 0 else 0

        # 3. Calculate totals
        total_revenue = round(subscription_revenue + ai_revenue, 2)
        total_expenses = round(commissions_total + RENDER_MONTHLY_COST + anthropic_cost, 2)
        profit_before_tax = round(total_revenue - total_expenses, 2)
        estimated_tax = round(max(0, profit_before_tax) * CORPORATE_TAX_RATE, 2)
        profit_after_tax = round(profit_before_tax - estimated_tax, 2)

        # 4. Format commissions by rep
        commissions_by_rep = []
        for rep, data in sorted(commissions_map.items(), key=lambda x: -x[1]["revenue"]):
            rate = 0.0 if rep.lower() == OWNER_NAME.lower() else REP_COMMISSION_RATE
            commissions_by_rep.append({
                "representant": rep,
                "clients": data["clients"],
                "revenue": round(data["revenue"], 2),
                "commission": round(data["commission"], 2),
                "rate": rate,
            })

        return {
            "month": m,
            "year": y,
            "erp_monthly_price": ERP_MONTHLY_PRICE,
            "total_entreprises": total_entreprises,
            "subscription_revenue": subscription_revenue,
            "subscription_count": len(subscriptions),
            "ai_revenue": ai_revenue,
            "total_revenue": total_revenue,
            "commissions_total": commissions_total,
            "render_cost": RENDER_MONTHLY_COST,
            "anthropic_cost": anthropic_cost,
            "total_expenses": total_expenses,
            "profit_before_tax": profit_before_tax,
            "tax_rate": CORPORATE_TAX_RATE,
            "estimated_tax": estimated_tax,
            "profit_after_tax": profit_after_tax,
            "subscriptions_detail": subscriptions_detail,
            "commissions_by_rep": commissions_by_rep,
        }
    except Exception as exc:
        logger.error("get_finances error: %s", exc)
        return {
            "month": m, "year": y,
            "erp_monthly_price": ERP_MONTHLY_PRICE,
            "total_entreprises": 0,
            "subscription_revenue": 0, "subscription_count": 0,
            "ai_revenue": 0, "total_revenue": 0,
            "commissions_total": 0, "render_cost": RENDER_MONTHLY_COST,
            "anthropic_cost": 0, "total_expenses": RENDER_MONTHLY_COST,
            "profit_before_tax": round(-RENDER_MONTHLY_COST, 2),
            "tax_rate": CORPORATE_TAX_RATE, "estimated_tax": 0,
            "profit_after_tax": round(-RENDER_MONTHLY_COST, 2),
            "subscriptions_detail": [], "commissions_by_rep": [],
        }
    finally:
        if cursor:
            cursor.close()
        conn.close()
