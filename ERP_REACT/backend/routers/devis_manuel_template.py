"""
ERP React - Devis Manual Template Router

Catalogue personnalisable du sous-module Manuel des Soumissions:
- Sections personnalisees (creees par l'utilisateur, en plus des 9 sections fixes 0.0-8.0)
- Lignes personnalisees (attachees soit a une section fixe via section_code, soit a une section perso via section_id)

Aucun item du template fixe n'est duplique en BD - il reste dans constructionItems.ts cote frontend.
"""

import logging
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from typing import Optional

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db

# Section codes des 9 sections fixes du template Manuel (constructionItems.ts: 0.0 a 8.0).
# Toute valeur hors de cette whitelist serait orpheline (jamais affichee, jamais utilisable).
ALLOWED_SECTION_CODES = {"0.0", "1.0", "2.0", "3.0", "4.0", "5.0", "6.0", "7.0", "8.0"}

# Zero-width / invisible Unicode chars that survive str.strip() and would let users create
# "empty-looking" names (visually blank but technically non-empty). Defense-in-depth strip.
# Built from explicit codepoints (U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ, U+2060 WORD JOINER,
# U+FEFF ZWNBSP/BOM) to avoid any editor/encoding ambiguity in the source file.
_INVISIBLE_CHARS = "".join(chr(c) for c in (0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF))
_INVISIBLE_CHARS_RE = re.compile(f"[{_INVISIBLE_CHARS}]")


def _normalize_text(v):
    """Strip ASCII whitespace + invisible Unicode chars. Returns the value unchanged if not a str."""
    if not isinstance(v, str):
        return v
    return _INVISIBLE_CHARS_RE.sub('', v).strip()

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/devis/manuel-template", tags=["Devis Manuel Template"])


# Memoization: avoid running CREATE TABLE on every request once a tenant is verified
_tables_ensured_for: set = set()


_DDL_STATEMENTS = [
    (
        "manuel_custom_sections",
        """
        CREATE TABLE IF NOT EXISTS manuel_custom_sections (
            id SERIAL PRIMARY KEY,
            nom VARCHAR(255) NOT NULL,
            sequence INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            created_by INTEGER
        )
        """,
    ),
    (
        "manuel_custom_lignes",
        """
        CREATE TABLE IF NOT EXISTS manuel_custom_lignes (
            id SERIAL PRIMARY KEY,
            section_code VARCHAR(20),
            section_id INTEGER REFERENCES manuel_custom_sections(id) ON DELETE CASCADE,
            titre VARCHAR(255) NOT NULL,
            description TEXT DEFAULT '',
            unite VARCHAR(50) DEFAULT 'forfait',
            prix_unitaire NUMERIC(15,2) DEFAULT 0,
            quantite_default NUMERIC(15,2) DEFAULT 1,
            categorie VARCHAR(255),
            sequence INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            CONSTRAINT manuel_lignes_section_check CHECK (section_code IS NOT NULL OR section_id IS NOT NULL)
        )
        """,
    ),
    (
        "idx_manuel_lignes_section_code",
        "CREATE INDEX IF NOT EXISTS idx_manuel_lignes_section_code ON manuel_custom_lignes(section_code)",
    ),
    (
        "idx_manuel_lignes_section_id",
        "CREATE INDEX IF NOT EXISTS idx_manuel_lignes_section_id ON manuel_custom_lignes(section_id)",
    ),
]


def _is_ddl_race(exc) -> bool:
    """Detect benign concurrent CREATE IF NOT EXISTS race at pg_catalog level."""
    pgcode = getattr(exc, "pgcode", None) or ""
    err = str(exc)
    return (
        pgcode in ("23505", "42P07", "42710")  # unique_violation, duplicate_table, duplicate_object
        or "pg_class_relname_nsp_index" in err
        or "pg_type_typname_nsp_index" in err
        or "already exists" in err.lower()
    )


def _ensure_template_tables(cursor, conn, schema: str) -> None:
    """Create manuel_custom_sections + manuel_custom_lignes tables if missing.
    Memoized per tenant schema. Caller must already be in tenant context.

    All 4 DDL statements are executed independently (per-statement try/except)
    so a benign race on one (e.g. sections) does not prevent the others
    (lignes, indexes) from being attempted. Without per-stmt isolation, a
    losing-worker that races on sections would memoize the schema while
    lignes might not yet exist on its perspective, causing later SELECT
    errors. The per-stmt loop guarantees every object has been seen-or-raced.
    """
    if schema and schema in _tables_ensured_for:
        return
    try:
        for name, stmt in _DDL_STATEMENTS:
            try:
                cursor.execute(stmt)
            except Exception as ddl_exc:
                if _is_ddl_race(ddl_exc):
                    # Concurrent CREATE IF NOT EXISTS race at pg_catalog level —
                    # IF NOT EXISTS check is not atomic across connections. The
                    # other worker won the race; object now exists. Cursor in
                    # autocommit mode (no caller flips it) remains usable.
                    logger.debug(
                        "_ensure_template_tables: race on %s (benign, retried): %s",
                        name, ddl_exc,
                    )
                    continue
                # Real error — propagate to outer except for proper cleanup.
                raise
        if schema:
            _tables_ensured_for.add(schema)
    except Exception as exc:
        logger.error("_ensure_template_tables failed for %s: %s", schema, exc)
        try:
            conn.rollback()
            if schema:
                db.set_tenant(conn, schema)
        except Exception:
            pass
        # Re-raise so caller surfaces a 500 instead of silently failing later with "relation does not exist"
        raise


# ============================================
# PYDANTIC SCHEMAS
# ============================================


class SectionCreate(BaseModel):
    nom: str = Field(..., min_length=1, max_length=255)
    sequence: Optional[int] = 0

    @field_validator("nom", mode="before")
    @classmethod
    def _strip_nom(cls, v):
        # Strip ASCII + invisible Unicode chars before min_length check.
        if isinstance(v, str):
            v = _normalize_text(v)
            if not v:
                raise ValueError("Le nom ne peut pas etre vide")
        return v


class SectionUpdate(BaseModel):
    nom: Optional[str] = Field(None, min_length=1, max_length=255)
    sequence: Optional[int] = None

    @field_validator("nom", mode="before")
    @classmethod
    def _strip_nom(cls, v):
        if isinstance(v, str):
            v = _normalize_text(v)
            if not v:
                raise ValueError("Le nom ne peut pas etre vide")
        return v


class LigneCreate(BaseModel):
    section_code: Optional[str] = Field(None, max_length=20)
    section_id: Optional[int] = None
    titre: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field("", max_length=5000)
    unite: Optional[str] = Field("forfait", max_length=50)
    prix_unitaire: Optional[float] = Field(0, ge=0, le=999999999)
    quantite_default: Optional[float] = Field(1, ge=0, le=999999999)
    categorie: Optional[str] = Field(None, max_length=255)
    sequence: Optional[int] = 0

    @field_validator("titre", mode="before")
    @classmethod
    def _strip_titre(cls, v):
        if isinstance(v, str):
            v = _normalize_text(v)
            if not v:
                raise ValueError("Le titre ne peut pas etre vide")
        return v

    @field_validator("section_code")
    @classmethod
    def _validate_section_code(cls, v):
        # Whitelist: empeche d'inserer des lignes orphelines avec des codes inexistants (ex: "999.0")
        if v is not None and v not in ALLOWED_SECTION_CODES:
            raise ValueError(
                f"section_code invalide. Valeurs autorisees: {sorted(ALLOWED_SECTION_CODES)}"
            )
        return v


class LigneUpdate(BaseModel):
    titre: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=5000)
    unite: Optional[str] = Field(None, max_length=50)
    prix_unitaire: Optional[float] = Field(None, ge=0, le=999999999)
    quantite_default: Optional[float] = Field(None, ge=0, le=999999999)
    categorie: Optional[str] = Field(None, max_length=255)
    sequence: Optional[int] = None

    @field_validator("titre", mode="before")
    @classmethod
    def _strip_titre(cls, v):
        if v is None:
            return v
        if isinstance(v, str):
            v = _normalize_text(v)
            if not v:
                raise ValueError("Le titre ne peut pas etre vide")
        return v


def _serialize_section(row: dict) -> dict:
    """Output snake_case; the axios response interceptor converts to camelCase client-side
    (consistent with all other ERP routers)."""
    return {
        "id": row["id"],
        "nom": row["nom"],
        "sequence": row["sequence"],
        "created_at": str(row["created_at"]) if row.get("created_at") else None,
        "updated_at": str(row["updated_at"]) if row.get("updated_at") else None,
    }


def _serialize_ligne(row: dict) -> dict:
    pu = row.get("prix_unitaire")
    qd = row.get("quantite_default")
    seq = row.get("sequence")
    desc = row.get("description")
    unite = row.get("unite")
    return {
        "id": row["id"],
        "section_code": row.get("section_code"),
        "section_id": row.get("section_id"),
        "titre": row["titre"],
        "description": desc if desc is not None else "",
        "unite": unite if unite is not None else "forfait",
        "prix_unitaire": float(pu) if pu is not None else 0.0,
        "quantite_default": float(qd) if qd is not None else 1.0,
        "categorie": row.get("categorie"),
        "sequence": int(seq) if seq is not None else 0,
        "created_at": str(row["created_at"]) if row.get("created_at") else None,
        "updated_at": str(row["updated_at"]) if row.get("updated_at") else None,
    }


# ============================================
# SECTIONS - CRUD
# ============================================


@router.get("/sections")
async def list_sections(user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_template_tables(cursor, conn, user.schema)
        cursor.execute(
            "SELECT id, nom, sequence, created_at, updated_at "
            "FROM manuel_custom_sections "
            "ORDER BY sequence ASC, id ASC"
        )
        rows = cursor.fetchall()
        return {"items": [_serialize_section(dict(r)) for r in rows]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_sections error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement des sections")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/sections")
async def create_section(payload: SectionCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_template_tables(cursor, conn, user.schema)
        # Auto-sequence: assign MAX+1 atomically in a single INSERT to avoid race conditions
        # where two concurrent POST /sections requests would both read MAX=N and insert N+1.
        # The subquery is evaluated once per row at INSERT time within the same statement.
        if payload.sequence is None or payload.sequence == 0:
            cursor.execute(
                "INSERT INTO manuel_custom_sections (nom, sequence, created_by) "
                "VALUES (%s, (SELECT COALESCE(MAX(sequence), 0) + 1 FROM manuel_custom_sections), %s) "
                "RETURNING id, nom, sequence, created_at, updated_at",
                (payload.nom.strip(), getattr(user, "id", None)),
            )
        else:
            cursor.execute(
                "INSERT INTO manuel_custom_sections (nom, sequence, created_by) "
                "VALUES (%s, %s, %s) "
                "RETURNING id, nom, sequence, created_at, updated_at",
                (payload.nom.strip(), payload.sequence, getattr(user, "id", None)),
            )
        row = cursor.fetchone()
        conn.commit()
        return _serialize_section(dict(row))
    except Exception as exc:
        logger.error("create_section error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la section")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/sections/{section_id}")
async def update_section(section_id: int, payload: SectionUpdate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_template_tables(cursor, conn, user.schema)
        sets = []
        params: list = []
        if payload.nom is not None:
            sets.append("nom = %s")
            params.append(payload.nom.strip())
        if payload.sequence is not None:
            sets.append("sequence = %s")
            params.append(payload.sequence)
        if not sets:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        sets.append("updated_at = NOW()")
        params.append(section_id)
        cursor.execute(
            f"UPDATE manuel_custom_sections SET {', '.join(sets)} WHERE id = %s "
            f"RETURNING id, nom, sequence, created_at, updated_at",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Section introuvable")
        conn.commit()
        return _serialize_section(dict(row))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_section error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/sections/{section_id}")
async def delete_section(section_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_template_tables(cursor, conn, user.schema)
        # Lignes are deleted via ON DELETE CASCADE on section_id FK
        cursor.execute("DELETE FROM manuel_custom_sections WHERE id = %s RETURNING id", (section_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Section introuvable")
        conn.commit()
        return {"success": True, "id": section_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_section error: %s", exc)
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


# ============================================
# LIGNES - CRUD
# ============================================


@router.get("/lignes")
async def list_lignes(user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_template_tables(cursor, conn, user.schema)
        cursor.execute(
            "SELECT id, section_code, section_id, titre, description, unite, "
            "prix_unitaire, quantite_default, categorie, sequence, created_at, updated_at "
            "FROM manuel_custom_lignes "
            "ORDER BY section_code NULLS LAST, section_id NULLS LAST, sequence ASC, id ASC"
        )
        rows = cursor.fetchall()
        return {"items": [_serialize_ligne(dict(r)) for r in rows]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("list_lignes error: %s", exc)
        raise HTTPException(status_code=500, detail="Erreur lors du chargement des lignes")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.post("/lignes")
async def create_ligne(payload: LigneCreate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    if not payload.section_code and not payload.section_id:
        raise HTTPException(
            status_code=400,
            detail="section_code ou section_id requis",
        )
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_template_tables(cursor, conn, user.schema)
        # Validate section_id exists if provided
        if payload.section_id is not None:
            cursor.execute("SELECT 1 FROM manuel_custom_sections WHERE id = %s", (payload.section_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="Section parente introuvable")
        # Auto-sequence per scope: compute MAX+1 atomically within the INSERT to avoid the race
        # where two concurrent POST /lignes for the same section both read MAX=N and insert N+1.
        # The subquery is evaluated per inserted row inside the same statement (atomic in PG).
        scoped_filter = "section_code = %s" if payload.section_code else "section_id = %s"
        scope_value = payload.section_code if payload.section_code else payload.section_id
        if payload.sequence is None or payload.sequence == 0:
            cursor.execute(
                "INSERT INTO manuel_custom_lignes "
                "(section_code, section_id, titre, description, unite, prix_unitaire, "
                "quantite_default, categorie, sequence) "
                f"VALUES (%s, %s, %s, %s, %s, %s, %s, %s, "
                f"  (SELECT COALESCE(MAX(sequence), 0) + 1 FROM manuel_custom_lignes WHERE {scoped_filter})) "
                "RETURNING id, section_code, section_id, titre, description, unite, "
                "prix_unitaire, quantite_default, categorie, sequence, created_at, updated_at",
                (
                    payload.section_code,
                    payload.section_id,
                    payload.titre.strip(),
                    payload.description if payload.description is not None else "",
                    payload.unite if payload.unite is not None else "forfait",
                    payload.prix_unitaire if payload.prix_unitaire is not None else 0,
                    payload.quantite_default if payload.quantite_default is not None else 1,
                    payload.categorie,
                    scope_value,
                ),
            )
        else:
            cursor.execute(
                "INSERT INTO manuel_custom_lignes "
                "(section_code, section_id, titre, description, unite, prix_unitaire, "
                "quantite_default, categorie, sequence) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "RETURNING id, section_code, section_id, titre, description, unite, "
                "prix_unitaire, quantite_default, categorie, sequence, created_at, updated_at",
                (
                    payload.section_code,
                    payload.section_id,
                    payload.titre.strip(),
                    payload.description if payload.description is not None else "",
                    payload.unite if payload.unite is not None else "forfait",
                    payload.prix_unitaire if payload.prix_unitaire is not None else 0,
                    payload.quantite_default if payload.quantite_default is not None else 1,
                    payload.categorie,
                    payload.sequence,
                ),
            )
        row = cursor.fetchone()
        conn.commit()
        return _serialize_ligne(dict(row))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("create_ligne error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la creation de la ligne")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.put("/lignes/{ligne_id}")
async def update_ligne(ligne_id: int, payload: LigneUpdate, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_template_tables(cursor, conn, user.schema)
        sets = []
        params: list = []
        if payload.titre is not None:
            sets.append("titre = %s")
            params.append(payload.titre.strip())
        if payload.description is not None:
            sets.append("description = %s")
            params.append(payload.description)
        if payload.unite is not None:
            sets.append("unite = %s")
            params.append(payload.unite)
        if payload.prix_unitaire is not None:
            sets.append("prix_unitaire = %s")
            params.append(payload.prix_unitaire)
        if payload.quantite_default is not None:
            sets.append("quantite_default = %s")
            params.append(payload.quantite_default)
        if payload.categorie is not None:
            sets.append("categorie = %s")
            params.append(payload.categorie)
        if payload.sequence is not None:
            sets.append("sequence = %s")
            params.append(payload.sequence)
        if not sets:
            raise HTTPException(status_code=400, detail="Aucun champ a mettre a jour")
        sets.append("updated_at = NOW()")
        params.append(ligne_id)
        cursor.execute(
            f"UPDATE manuel_custom_lignes SET {', '.join(sets)} WHERE id = %s "
            f"RETURNING id, section_code, section_id, titre, description, unite, "
            f"prix_unitaire, quantite_default, categorie, sequence, created_at, updated_at",
            params,
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Ligne introuvable")
        conn.commit()
        return _serialize_ligne(dict(row))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("update_ligne error: %s", exc)
        try:
            conn.rollback()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Erreur lors de la mise a jour")
    finally:
        if cursor:
            cursor.close()
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.delete("/lignes/{ligne_id}")
async def delete_ligne(ligne_id: int, user: ErpUser = Depends(get_current_user)):
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    conn = db.get_conn()
    cursor = None
    try:
        db.set_tenant(conn, user.schema)
        cursor = conn.cursor()
        _ensure_template_tables(cursor, conn, user.schema)
        cursor.execute("DELETE FROM manuel_custom_lignes WHERE id = %s RETURNING id", (ligne_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Ligne introuvable")
        conn.commit()
        return {"success": True, "id": ligne_id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_ligne error: %s", exc)
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
