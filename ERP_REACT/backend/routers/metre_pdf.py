"""
ERP React - Metre PDF Router
Prise de mesures sur plans PDF: upload, calibration, mesures, calques, produits, export.
Ported from METRE_PDF standalone module into the ERP multi-tenant architecture.
"""

import asyncio
import base64
import csv
import io
import json
import logging
import os
import re
import time
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import Any, Optional
from datetime import datetime
from enum import Enum
from urllib.parse import quote as urlquote

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field

from ..erp_auth import get_current_user, ErpUser
from .. import erp_database as db
from .ai import _check_credits, _deduct_credits, track_ai_usage

# Optional PDF rendering dependency
try:
    import fitz  # PyMuPDF
    _HAS_FITZ = True
except ImportError:
    _HAS_FITZ = False

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/metre", tags=["Metre PDF"])


def _require_tenant(user: ErpUser = Depends(get_current_user)) -> ErpUser:
    """Dependency that ensures user has a tenant schema."""
    if not user.schema:
        raise HTTPException(status_code=400, detail="Contexte tenant manquant")
    return user


# =============================================================================
# CONFIGURATION
# =============================================================================

UPLOAD_DIR = Path(os.environ.get("METRE_PDF_UPLOAD_DIR", os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "uploads", "metre_pdf"
)))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE_MB = int(os.environ.get("METRE_MAX_FILE_SIZE_MB", "150"))
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_SNAP_REGION_PX = int(os.environ.get("METRE_MAX_SNAP_REGION_PX", "4000"))
PDF_RENDER_CACHE_SIZE = int(os.environ.get("METRE_PDF_RENDER_CACHE_SIZE", "50"))
PDF_RENDER_CACHE_TTL = int(os.environ.get("METRE_PDF_RENDER_CACHE_TTL", "3600"))


# =============================================================================
# PYDANTIC MODELS
# =============================================================================

class MeasurementUnit(str, Enum):
    mm = "mm"
    cm = "cm"
    m = "m"
    ft = "ft"
    inch = "in"


class MeasurementType(str, Enum):
    distance = "distance"
    area = "area"
    perimeter = "perimeter"
    angle = "angle"
    count = "count"


class SnapPointType(str, Enum):
    endpoint = "endpoint"
    midpoint = "midpoint"
    intersection = "intersection"
    perpendicular = "perpendicular"


class ExportFormat(str, Enum):
    csv = "csv"
    json = "json"


class Point(BaseModel):
    x: float
    y: float


class SnapPoint(BaseModel):
    x: float
    y: float
    type: SnapPointType


# --- Project ---

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    company_id: Optional[int] = None
    devis_id: Optional[int] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    company_id: Optional[int] = None
    devis_id: Optional[int] = None


class ProjectResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    company_id: Optional[int] = None
    devis_id: Optional[int] = None
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class MetreLibraryEntry(BaseModel):
    """Aggregated summary of a métré (project) for the library list view."""
    id: int
    name: str
    description: Optional[str] = None
    devis_id: Optional[int] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    measurement_count: int = 0
    layer_count: int = 0
    document_count: int = 0
    primary_document_id: Optional[int] = None
    primary_document_filename: Optional[str] = None
    primary_document_original_filename: Optional[str] = None
    primary_document_page_count: Optional[int] = None


# --- PDFDocument ---

class PDFDocumentResponse(BaseModel):
    id: int
    project_id: int
    filename: str
    original_filename: str
    page_count: int
    file_size_bytes: Optional[int] = None
    uploaded_at: Optional[datetime] = None
    # Always 'application/pdf' for newly uploaded docs (forced server-side
    # after magic-byte validation). NULL for documents inserted before the
    # BYTEA migration — frontend should default to 'application/pdf' too.
    mime_type: Optional[str] = None
    # True when the PDF binary is stored in BD (BYTEA) — i.e. the document
    # will survive any Render redeploy. False = legacy document still relying
    # on the (ephemeral) disk; the frontend can use this to surface a
    # "re-upload your PDF" prompt before the next deploy purges it.
    has_file_data: Optional[bool] = None


# --- Calibration ---

class CalibrationCreate(BaseModel):
    page_number: int = Field(..., ge=0)
    scale_factor: float = Field(..., gt=0, description="Pixels par unite reelle")
    unit: MeasurementUnit = MeasurementUnit.m
    reference_length: float = Field(..., gt=0, description="Longueur de reference reelle")
    pixel_length: float = Field(..., gt=0, description="Longueur en pixels mesuree")


class CalibrationResponse(BaseModel):
    id: int
    document_id: int
    page_number: int
    scale_factor: float
    unit: str
    reference_length: float
    pixel_length: float
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# --- Measurement ---

# Max serialized size for `metadata_json` JSONB field (client-side extended fields).
# Protects against DoS via bloated rows. 64 KB is generous for a single measurement.
MAX_METADATA_JSON_BYTES = 64 * 1024

# Max serialized size for `composite_inputs` JSONB field on metre_layers.
# Composite inputs are typically small (handful of slider values), 16 KB suffit largement.
MAX_COMPOSITE_INPUTS_BYTES = 16 * 1024


def _validate_metadata_size(metadata: Optional[dict]) -> Optional[dict]:
    """Raise HTTPException 413 if the JSON-serialized metadata exceeds the limit."""
    if metadata is None:
        return None
    size = len(json.dumps(metadata))
    if size > MAX_METADATA_JSON_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"metadata_json trop volumineux ({size} octets, max {MAX_METADATA_JSON_BYTES}).",
        )
    return metadata


def _validate_composite_inputs_size(
    composite_inputs: Optional[dict],
) -> Optional[dict]:
    """Raise HTTPException 413 if the JSON-serialized composite_inputs exceeds the limit."""
    if composite_inputs is None:
        return None
    size = len(json.dumps(composite_inputs))
    if size > MAX_COMPOSITE_INPUTS_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"composite_inputs trop volumineux ({size} octets, "
                f"max {MAX_COMPOSITE_INPUTS_BYTES})."
            ),
        )
    return composite_inputs


class MeasurementCreate(BaseModel):
    page_number: int = Field(..., ge=0)
    type: str = Field(..., max_length=50)
    label: Optional[str] = Field(None, max_length=255)
    value: float = Field(..., ge=0)
    unit: MeasurementUnit = MeasurementUnit.m
    points: list[Point] = Field(default_factory=list)
    color: str = Field(default="#FF0000", pattern=r'^#[0-9a-fA-F]{6}$')
    layer_id: Optional[int] = None
    product_id: Optional[int] = None
    quantity: Optional[float] = Field(default=1, ge=0)
    # Extended client-side fields persisted as JSONB (slopeFactor, isDeduction, etc.)
    metadata_json: Optional[dict] = None


class MeasurementUpdate(BaseModel):
    label: Optional[str] = Field(None, max_length=255)
    value: Optional[float] = Field(None, ge=0)
    unit: Optional[MeasurementUnit] = None
    points: Optional[list[Point]] = None
    color: Optional[str] = Field(None, pattern=r'^#[0-9a-fA-F]{6}$')
    layer_id: Optional[int] = None
    product_id: Optional[int] = None
    quantity: Optional[float] = Field(None, ge=0)
    metadata_json: Optional[dict] = None


class MeasurementResponse(BaseModel):
    id: int
    document_id: int
    page_number: int
    type: str
    label: Optional[str] = None
    value: float
    unit: str
    points: list[Point] = Field(default_factory=list)
    color: str
    layer_id: Optional[int] = None
    product_id: Optional[int] = None
    quantity: Optional[float] = Field(default=1, ge=0)
    metadata_json: Optional[dict] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# --- Layer ---

class LayerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    color: str = Field(default="#0000FF", pattern=r'^#[0-9a-fA-F]{6}$')
    visible: bool = True
    locked: bool = False
    composite_id: Optional[int] = None
    composite_inputs: Optional[dict] = None


class LayerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    color: Optional[str] = Field(None, pattern=r'^#[0-9a-fA-F]{6}$')
    visible: Optional[bool] = None
    locked: Optional[bool] = None
    composite_id: Optional[int] = None
    composite_inputs: Optional[dict] = None


class LayerResponse(BaseModel):
    id: int
    document_id: int
    name: str
    color: str
    visible: bool
    locked: bool
    composite_id: Optional[int] = None
    composite_inputs: Optional[dict] = None
    created_at: Optional[datetime] = None


# --- AI Detection ---

class AIDetectionRequest(BaseModel):
    page_number: int = Field(..., ge=1, description="Page number 1-based (ERP_REACT convention)")
    detection_types: list[str] = Field(
        default_factory=lambda: ["surface", "distance", "count"],
        description="Types a detecter: surface, distance, count"
    )
    additional_context: Optional[str] = Field(None, max_length=1000, description="Contexte additionnel pour l'IA")
    # PHASE 2: BOM-aware mode
    section_numero: Optional[str] = Field(None, max_length=255, description="Filtrer le catalogue produits par numero_section (ex: '01') OU par category (ex: 'Fenetres', 'Revetement exterieur') si fallback active")
    use_bom_catalog: bool = Field(default=False, description="Si True, inclut les produits du catalogue dans le prompt Claude")


class AIDetectMultiSectionRequest(BaseModel):
    page_number: int = Field(..., ge=1, description="Page number 1-based (ERP_REACT convention)")
    # Round 8 C1 fix: max_items=5 (was 20) to avoid HTTP proxy timeout. Each
    # Claude Vision call takes 30-90s; 5 sections = ~5min worst case which is
    # at the edge of typical reverse-proxy timeouts (300s). Larger runs need
    # background-task architecture (TODO Phase 3).
    # Round 8 C2 fix: per-item constraints + dedup at runtime.
    sections: list[str] = Field(
        ...,
        min_length=1,
        max_length=5,
        description="Liste de numero_section a traiter (ex: ['01','02','03']). Max 5 par appel sync.",
    )
    auto_create_layer_per_section: bool = Field(default=True, description="Creer un layer dedie par section detectee")
    additional_context: Optional[str] = Field(None, max_length=1000)


class AIDetectMultiSectionResult(BaseModel):
    page_number: int
    sections_processed: list[str]
    sections_failed: list[str]
    sections_empty_bom: list[str] = Field(
        default_factory=list,
        description="Sections sans aucun produit dans le catalogue (skipped).",
    )
    total_detections: int
    total_cost_usd: float
    total_tokens_in: int
    total_tokens_out: int
    detections_by_section: dict[str, int]
    bom_truncated_sections: list[str] = Field(
        default_factory=list,
        description="Sections dont la BOM a ete tronquee a 50 produits (perte qualite).",
    )


# PHASE 3: Mode INVENTAIRE RAPIDE (alternative au mode markup overlay).
# Claude lit le plan et retourne une liste TEXTE structuree (item, dimensions, qty,
# notes) sans coordonnees ni bounding box. Plus precis pour plans manuscrits car
# Claude n'a pas a pointer des coordonnees exactes.

class AIQuickInventoryRequest(BaseModel):
    page_number: int = Field(..., ge=1, description="Page number 1-based")
    query: str = Field(..., min_length=1, max_length=500, description="Question utilisateur (ex: 'Fenetres agrandissement')")
    additional_context: Optional[str] = Field(None, max_length=1000)
    section_numero: Optional[str] = Field(None, max_length=255, description="Optionnel: filtrer BOM par section/category")
    use_bom_catalog: bool = Field(default=False)
    precision_mode: bool = Field(default=True, description="Active Adaptive Thinking d'Anthropic sur Opus 4.7 (effort=\"high\"). Plus precis (recommande, defaut). ~3x plus cher.")


class AIQuickInventoryItem(BaseModel):
    item: str = Field(..., max_length=255, description="Type d'element (ex: 'Fenetre guillotine')")
    dimensions: Optional[str] = Field(None, max_length=100, description="ex: '36x54' ou '62\"x54\"'")
    quantity: float = Field(..., ge=0)
    unit: str = Field(default="un", max_length=20, description="un, pi.ca, pi.li, m, etc.")
    notes: Optional[str] = Field(None, max_length=500)
    category: Optional[str] = None
    product_id: Optional[int] = None


class AIQuickInventoryResult(BaseModel):
    page_number: int
    inventory: list[AIQuickInventoryItem]
    summary: str
    total_items: int
    cost_usd: float
    tokens_in: int
    tokens_out: int
    claude_model: str
    precision_mode_used: bool = False
    thinking_tokens: int = 0  # tokens utilises pour le raisonnement interne


class AvailableSectionsResponse(BaseModel):
    sections: list[str]
    section_count: int


class AIDetectionItem(BaseModel):
    """Une detection retournee par Claude Vision (avant persistence)."""
    detection_type: str
    category: Optional[str] = None
    label: Optional[str] = None
    points: list[Point] = Field(default_factory=list)
    bounding_box: Optional[dict] = None
    detected_value: float
    unit: str = "pi.ca"
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    color: str = Field(default="#10B981", pattern=r'^#[0-9a-fA-F]{6}$')


class AIDetectionResponse(BaseModel):
    id: int
    document_id: int
    page_number: int
    detection_type: str
    category: Optional[str] = None
    label: Optional[str] = None
    points: list[Point] = Field(default_factory=list)
    bounding_box: Optional[dict] = None
    detected_value: float
    unit: str
    confidence: float
    color: str
    status: str
    user_correction_value: Optional[float] = None
    measurement_id: Optional[int] = None
    claude_model: Optional[str] = None
    claude_tokens_in: Optional[int] = None
    claude_tokens_out: Optional[int] = None
    claude_cost_usd: Optional[float] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AIDetectionStatusUpdate(BaseModel):
    status: str = Field(..., pattern=r'^(accepted|rejected|corrected)$')
    user_correction_value: Optional[float] = Field(None, ge=0)
    create_measurement: bool = Field(default=False, description="Si accepte, creer auto un metre_measurements")


class AIDetectRunResult(BaseModel):
    detections: list[AIDetectionResponse]
    page_number: int
    total: int
    cost_usd: float
    tokens_in: int
    tokens_out: int


class ImportToDevisRequest(BaseModel):
    measurement_ids: list[int] = Field(..., min_items=1)
    auto_price: bool = Field(default=True)
    default_categorie: Optional[str] = Field(default="Metre IA", max_length=100)


class ImportToDevisResponse(BaseModel):
    devis_id: int
    lignes_created: int
    lignes_skipped: int
    measurement_ids_imported: list[int]
    measurement_ids_skipped: list[int]
    total_montant: float


# --- Product ---

# display_mode is validated as a plain string (pattern) rather than an Enum type
# so `model_dump()` yields `'detailed'` / `'summary'` directly. Using an `Enum`
# produces `DisplayMode.detailed` objects which psycopg2 cannot adapt.
_DISPLAY_MODE_PATTERN = r'^(detailed|summary)$'


class BomInputDef(BaseModel):
    """Schema d'un input parametrique d'un produit composite."""
    name: str = Field(..., min_length=1, max_length=80, pattern=r'^[a-z][a-z0-9_]*$')
    unit: str = Field(default="", max_length=20)  # 'pi', 'pi2', 'bool', 'u', etc.
    description: str = Field(default="", max_length=255)
    default: Optional[float] = None


class ProductCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: str = Field(default="", max_length=255)
    dimensions: str = Field(default="", max_length=255)
    price: float = Field(default=0, ge=0)
    price_unit: str = Field(default="un", max_length=50)
    color: str = Field(default="#3b82f6", pattern=r'^#[0-9a-fA-F]{6}$')
    waste_pct: float = Field(default=0, ge=0, le=100)
    is_composite: bool = False
    display_mode: str = Field(default="detailed", pattern=_DISPLAY_MODE_PATTERN)
    price_override: Optional[float] = Field(None, ge=0)
    description: Optional[str] = None
    bom_inputs: Optional[list[BomInputDef]] = None
    # Labour-time defaults for composite BOMs (used in the estimation TSV).
    nb_hommes: Optional[float] = Field(None, ge=0)
    nb_hrs_par_jour: Optional[float] = Field(None, ge=0)
    nb_jours: Optional[float] = Field(None, ge=0)
    numero_section: Optional[str] = Field(None, max_length=20)
    labor_trade_id: Optional[str] = Field(None, max_length=80)


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    category: Optional[str] = Field(None, max_length=255)
    dimensions: Optional[str] = Field(None, max_length=255)
    price: Optional[float] = Field(None, ge=0)
    price_unit: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, pattern=r'^#[0-9a-fA-F]{6}$')
    waste_pct: Optional[float] = Field(None, ge=0, le=100)
    is_composite: Optional[bool] = None
    display_mode: Optional[str] = Field(None, pattern=_DISPLAY_MODE_PATTERN)
    price_override: Optional[float] = Field(None, ge=0)
    description: Optional[str] = None
    bom_inputs: Optional[list[BomInputDef]] = None
    nb_hommes: Optional[float] = Field(None, ge=0)
    nb_hrs_par_jour: Optional[float] = Field(None, ge=0)
    nb_jours: Optional[float] = Field(None, ge=0)
    numero_section: Optional[str] = Field(None, max_length=20)
    labor_trade_id: Optional[str] = Field(None, max_length=80)


class ProductComponentResponse(BaseModel):
    id: int
    parent_product_id: int
    child_product_id: int
    quantity_per_unit: float
    formula: Optional[str] = None
    notes: Optional[str] = None
    sort_order: int = 0
    # Convenience fields for the client (derived from the child product row).
    child_name: Optional[str] = None
    child_category: Optional[str] = None
    child_price: Optional[float] = None
    child_price_unit: Optional[str] = None
    child_waste_pct: Optional[float] = None
    child_color: Optional[str] = None


class ProductResponse(BaseModel):
    id: int
    name: str
    category: str = ""
    dimensions: str = ""
    price: float = 0
    price_unit: str = "un"
    color: str = "#3b82f6"
    waste_pct: float = 0
    is_composite: bool = False
    display_mode: str = "detailed"
    price_override: Optional[float] = None
    description: Optional[str] = None
    bom_inputs: Optional[list[dict]] = None
    # Labour-time fields (V9). Must be declared here so FastAPI's
    # response_model=ProductResponse does not filter them out of the
    # API response. Without these, the BD columns exist but the client
    # never sees them.
    nb_hommes: Optional[float] = None
    nb_hrs_par_jour: Optional[float] = None
    nb_jours: Optional[float] = None
    numero_section: Optional[str] = None
    labor_trade_id: Optional[str] = None
    components: list[ProductComponentResponse] = Field(default_factory=list)
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# --- Product component (BOM child line) ---

# Whitelist of characters allowed in a BOM formula. Validated server-side BEFORE
# storage AND BEFORE evaluation. Limits to: alphanumerics, underscore, +-*/().,,
# digit/decimal, comparison operators (>, <, >=, <=, ==, !=, =, <>), and braces
# (left over from the Excel extractor that uses `{var_name}` notation pre-cleanup).
# Refuses quotes, semicolons, square brackets, $, backticks — anything that could
# lead to code injection or eval-style attacks.
_FORMULA_SAFE_PATTERN = re.compile(r'^[a-zA-Z0-9_+\-*/()., <>=!{}\s]+$')


def _validate_formula(formula: Optional[str]) -> Optional[str]:
    if formula is None or not formula.strip():
        return None
    if len(formula) > 500:
        raise ValueError("Formule trop longue (max 500 chars)")
    if not _FORMULA_SAFE_PATTERN.match(formula):
        raise ValueError("Formule contient des caracteres non autorises")
    return formula.strip()


class ProductComponentCreate(BaseModel):
    child_product_id: int = Field(..., gt=0)
    quantity_per_unit: float = Field(default=1, ge=0)
    formula: Optional[str] = None
    notes: Optional[str] = None
    sort_order: int = 0


class ProductComponentUpdate(BaseModel):
    quantity_per_unit: Optional[float] = Field(None, ge=0)
    formula: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None


# --- Snap Point ---

class SnapPointRequest(BaseModel):
    page_number: int = Field(..., ge=0)
    region_x: float = Field(..., ge=0)
    region_y: float = Field(..., ge=0)
    region_width: float = Field(..., gt=0)
    region_height: float = Field(..., gt=0)
    tolerance: float = Field(default=10.0, gt=0, description="Rayon de detection en pixels")


class SnapPointResponse(BaseModel):
    points: list[SnapPoint]
    page_number: int
    detection_time_ms: float


# --- Summary ---

class MeasurementSummaryItem(BaseModel):
    type: str
    layer_name: Optional[str] = None
    count: int
    total_value: float
    unit: str


class MeasurementSummaryResponse(BaseModel):
    document_id: int
    total_measurements: int
    by_type: list[MeasurementSummaryItem]
    by_layer: list[MeasurementSummaryItem]


# =============================================================================
# FIELD WHITELISTS (SQL injection prevention)
# =============================================================================

ALLOWED_PROJECT_FIELDS = frozenset({'name', 'description', 'company_id', 'devis_id'})
ALLOWED_MEASUREMENT_FIELDS = frozenset({
    'label', 'value', 'unit', 'color', 'points', 'type',
    'page_number', 'layer_id', 'product_id', 'quantity', 'metadata_json',
})
ALLOWED_LAYER_FIELDS = frozenset({
    'name', 'color', 'visible', 'locked',
    'composite_id', 'composite_inputs',
})
ALLOWED_PRODUCT_FIELDS_UPDATE = frozenset({
    'name', 'category', 'dimensions', 'price', 'price_unit', 'color', 'waste_pct',
    'is_composite', 'display_mode', 'price_override', 'description', 'bom_inputs',
    'nb_hommes', 'nb_hrs_par_jour', 'nb_jours', 'numero_section', 'labor_trade_id',
})
ALLOWED_COMPONENT_FIELDS = frozenset({
    'quantity_per_unit', 'notes', 'sort_order', 'formula',
})


def _validate_fields(data: dict, allowed: frozenset, entity: str) -> dict:
    """Filter and validate field names against the whitelist.

    Preserves explicit `None` values so that PATCH/PUT calls can clear
    nullable columns (e.g. `formula=null` to remove a parametric formula,
    `bom_inputs=null` to detach a BOM schema). Pydantic models guarantee
    that NOT NULL columns (`name`, `display_mode`, etc.) cannot reach this
    helper with `None` because their `Optional[...]` declarations would
    require validators or `min_length` constraints to reject empty values
    upstream — verified for ProductUpdate, ProductComponentUpdate, etc.
    """
    valid = {k: v for k, v in data.items() if k in allowed}
    rejected = set(data.keys()) - allowed
    if rejected:
        logger.warning(f"Champs rejetes pour {entity}: {rejected}")
    return valid


# =============================================================================
# TABLE CREATION (auto-migration on first request)
# =============================================================================

_tables_ensured: set[str] = set()

# DRIFT GUARD (lecon #155 S31):
# Ce SQL DOIT rester aligne avec `metre_schema_sql.py:METRE_CREATE_TABLES_SQL`
# (source de verite utilisee par `erp_database.py:init_database_for_tenant` au signup).
# Toute modification de l'un DOIT etre repercutee dans l'autre.
# `auto_repair_tenants_startup.py:_KNOWN_FIXES` rattrape les ALTER ADD COLUMN
# si un drift survient sur tenants existants. Un test programmable Round 3
# valide 0 drift au moment de cet ecrit (16 ALTER ADD COLUMN identiques).
_CREATE_TABLES_SQL = """
-- Metre PDF tables

CREATE TABLE IF NOT EXISTS metre_projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    company_id INTEGER,
    devis_id INTEGER,
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Optional link to a devis (formulaires.id) so a métré can be associated with
-- the soumission it was used to produce. Nullable: a métré can exist on its
-- own and be linked later (or never).
ALTER TABLE metre_projects ADD COLUMN IF NOT EXISTS devis_id INTEGER;

CREATE TABLE IF NOT EXISTS metre_documents (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES metre_projects(id) ON DELETE CASCADE,
    filename VARCHAR(512) NOT NULL,
    original_filename VARCHAR(512) NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 1,
    file_size_bytes BIGINT,
    uploaded_at TIMESTAMP DEFAULT NOW(),
    -- PDF binary stored in BD so it survives Render redeploys (ephemeral fs).
    -- Nullable for backward compat with documents uploaded before this column
    -- existed — those still live on disk and the download endpoint falls back
    -- to the legacy path if file_data IS NULL.
    file_data BYTEA,
    mime_type VARCHAR(100) DEFAULT 'application/pdf'
);
-- Idempotent migration for existing tenants (table created before BYTEA storage).
ALTER TABLE metre_documents ADD COLUMN IF NOT EXISTS file_data BYTEA;
ALTER TABLE metre_documents ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) DEFAULT 'application/pdf';

CREATE TABLE IF NOT EXISTS metre_calibrations (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES metre_documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL DEFAULT 0,
    scale_factor DOUBLE PRECISION NOT NULL,
    unit VARCHAR(10) NOT NULL DEFAULT 'm',
    reference_length DOUBLE PRECISION NOT NULL,
    pixel_length DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (document_id, page_number)
);

CREATE TABLE IF NOT EXISTS metre_layers (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES metre_documents(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(9) DEFAULT '#0000FF',
    visible BOOLEAN DEFAULT true,
    locked BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metre_measurements (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES metre_documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL DEFAULT 0,
    type VARCHAR(50) NOT NULL,
    label VARCHAR(255),
    value DOUBLE PRECISION NOT NULL,
    unit VARCHAR(10) NOT NULL DEFAULT 'm',
    points JSONB DEFAULT '[]',
    color VARCHAR(9) DEFAULT '#FF0000',
    layer_id INTEGER REFERENCES metre_layers(id) ON DELETE SET NULL,
    product_id INTEGER,
    quantity DOUBLE PRECISION DEFAULT 1,
    -- Extended client-side fields (slopeFactor, isDeduction, fontSize, strokeWidth,
    -- opacity, textContent, zOrder, laborTradeId/Hours/Persons, symbolBlockId/Rotation/Scale,
    -- group, parentMeasurementId). Stored as JSONB to avoid schema churn.
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metre_products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(255) NOT NULL DEFAULT '',
    dimensions VARCHAR(255) NOT NULL DEFAULT '',
    price DOUBLE PRECISION NOT NULL DEFAULT 0,
    price_unit VARCHAR(50) NOT NULL DEFAULT 'un',
    color VARCHAR(9) NOT NULL DEFAULT '#3b82f6',
    waste_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_composite BOOLEAN NOT NULL DEFAULT false,
    display_mode VARCHAR(20) NOT NULL DEFAULT 'detailed',
    price_override DOUBLE PRECISION,
    description TEXT,
    created_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Product components (BOM / assemblies) — parent product contains child products
-- with a quantity-per-parent-unit multiplier.
CREATE TABLE IF NOT EXISTS metre_product_components (
    id SERIAL PRIMARY KEY,
    parent_product_id INTEGER NOT NULL REFERENCES metre_products(id) ON DELETE CASCADE,
    child_product_id INTEGER NOT NULL REFERENCES metre_products(id) ON DELETE RESTRICT,
    quantity_per_unit DOUBLE PRECISION NOT NULL DEFAULT 1,
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_composite_no_self CHECK (parent_product_id <> child_product_id),
    CONSTRAINT chk_composite_qty_positive CHECK (quantity_per_unit >= 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_metre_documents_project ON metre_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_metre_calibrations_doc ON metre_calibrations(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_metre_measurements_doc ON metre_measurements(document_id);
CREATE INDEX IF NOT EXISTS idx_metre_measurements_page ON metre_measurements(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_metre_measurements_layer ON metre_measurements(layer_id);
CREATE INDEX IF NOT EXISTS idx_metre_measurements_type ON metre_measurements(type);
CREATE INDEX IF NOT EXISTS idx_metre_layers_doc ON metre_layers(document_id);
CREATE INDEX IF NOT EXISTS idx_metre_products_category ON metre_products(category);
CREATE INDEX IF NOT EXISTS idx_metre_products_created_by ON metre_products(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON metre_projects(created_by);
CREATE INDEX IF NOT EXISTS idx_measurements_created_at ON metre_measurements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurements_product ON metre_measurements(product_id);
CREATE INDEX IF NOT EXISTS idx_metre_product_components_parent ON metre_product_components(parent_product_id);
CREATE INDEX IF NOT EXISTS idx_metre_product_components_child ON metre_product_components(child_product_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_metre_product_components_pair
    ON metre_product_components(parent_product_id, child_product_id);

-- Constraints (idempotent)
-- PG raises `duplicate_object` (42710) when a CONSTRAINT with the same name
-- already exists, BUT a UNIQUE constraint creates an implicit unique index
-- under the same name — and re-ADD raises `duplicate_table` (42P07) instead
-- (the index is a "relation"). Catch BOTH so legacy tenants don't crash the
-- whole `_ensure_tables` block on the first restart after a fresh deploy.

-- Defensive: guarantee PRIMARY KEY on metre_products(id) and
-- metre_product_components(id) for legacy tenants where the table was
-- created without a PK (pre-SERIAL PRIMARY KEY schema). Without this, the
-- fk_measurement_product ALTER below fails with "there is no unique
-- constraint matching given keys for referenced table metre_products".
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'metre_products'::regclass AND contype = 'p'
  ) THEN
    BEGIN
      ALTER TABLE metre_products ADD PRIMARY KEY (id);
    EXCEPTION
      WHEN duplicate_table THEN NULL;
      WHEN duplicate_object THEN NULL;
      WHEN invalid_table_definition THEN NULL;
    END;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'metre_product_components'::regclass AND contype = 'p'
  ) THEN
    BEGIN
      ALTER TABLE metre_product_components ADD PRIMARY KEY (id);
    EXCEPTION
      WHEN duplicate_table THEN NULL;
      WHEN duplicate_object THEN NULL;
      WHEN invalid_table_definition THEN NULL;
    END;
  END IF;
END $$;

-- Belt-and-suspenders: certains tenants legacy ont une PK existante mais
-- sur une autre colonne (composite ou non-id). Le ALTER fk_measurement_product
-- exige une UNIQUE/PK matching exactement (id) — un UNIQUE INDEX sur (id)
-- satisfait la FK meme quand la PK est ailleurs.
-- IF NOT EXISTS gere l'idempotence (re-execution _ensure_tables).
-- DO $$ EXCEPTION gere le cas (rare) ou metre_products(id) contient des
-- doublons legacy: WARNING + skip plutot que crash _ensure_tables.
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_metre_products_id ON metre_products(id);
EXCEPTION
  WHEN unique_violation THEN
    RAISE WARNING 'metre_products(id) has duplicates — skipping unique index';
END $$;

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_metre_product_components_id ON metre_product_components(id);
EXCEPTION
  WHEN unique_violation THEN
    RAISE WARNING 'metre_product_components(id) has duplicates — skipping unique index';
END $$;

DO $$ BEGIN
  ALTER TABLE metre_products
    ADD CONSTRAINT uq_metre_products_name_category UNIQUE (name, category);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_measurements ADD CONSTRAINT chk_measurement_color
    CHECK (color ~ '^#[0-9a-fA-F]{6}$' OR color ~ '^#[0-9a-fA-F]{8}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_layers ADD CONSTRAINT chk_layer_color
    CHECK (color ~ '^#[0-9a-fA-F]{6}$' OR color ~ '^#[0-9a-fA-F]{8}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_measurements ADD CONSTRAINT chk_positive_value
    CHECK (value >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_measurements ADD CONSTRAINT chk_page_positive
    CHECK (page_number >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_calibrations ADD CONSTRAINT chk_cal_page_positive
    CHECK (page_number >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_products ADD CONSTRAINT chk_product_price
    CHECK (price >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_products ADD CONSTRAINT chk_product_waste_pct
    CHECK (waste_pct >= 0 AND waste_pct <= 100);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_measurements
    ADD CONSTRAINT fk_measurement_product
    FOREIGN KEY (product_id) REFERENCES metre_products(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

ALTER TABLE metre_layers ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE metre_measurements ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb;

-- P3.4 calques lies au BOM (multi-instances par calque) - 2026-05-11.
-- Chaque calque peut etre lie a un composite (metre_products.id) pour generer
-- une instance dediee dans le BomEstimationPanel avec ses propres variables.
-- composite_id = NULL : comportement legacy (mesures du calque agregees au global).
-- composite_inputs = overrides JSONB pour les variables non-geometriques
--   (type_bois, espacement_cc, hauteur_mur_porteur). Forme:
--   {"type_bois": 6, "espacement_cc": 16, "hauteur_mur_porteur": 9}
ALTER TABLE metre_layers ADD COLUMN IF NOT EXISTS composite_id INTEGER;
ALTER TABLE metre_layers ADD COLUMN IF NOT EXISTS composite_inputs JSONB;

-- P3.4 FK: metre_layers.composite_id -> metre_products(id) ON DELETE SET NULL
-- Defense in depth : si tenant legacy a des orphelins, RAISE WARNING + skip.
DO $$ BEGIN
  ALTER TABLE metre_layers
    ADD CONSTRAINT fk_layers_composite
    FOREIGN KEY (composite_id) REFERENCES metre_products(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN foreign_key_violation THEN
    RAISE WARNING 'metre_layers.composite_id has orphans -- FK skipped';
END $$;
CREATE INDEX IF NOT EXISTS idx_metre_layers_composite ON metre_layers(composite_id);

-- Defensive ALTER TABLE for composite columns on existing tenants (pre-composite schema).
ALTER TABLE metre_products ADD COLUMN IF NOT EXISTS is_composite BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE metre_products ADD COLUMN IF NOT EXISTS display_mode VARCHAR(20) NOT NULL DEFAULT 'detailed';
ALTER TABLE metre_products ADD COLUMN IF NOT EXISTS price_override DOUBLE PRECISION;
ALTER TABLE metre_products ADD COLUMN IF NOT EXISTS description TEXT;

-- Parametric BOM extension: each composite product can declare a list of named inputs
-- (perimetre, surface, etc.) that drive child quantity formulas. Stored as JSONB:
--   [{"name":"perimetre_ss","unit":"pi","description":"Perimetre sous-sol","default":0}]
ALTER TABLE metre_products ADD COLUMN IF NOT EXISTS bom_inputs JSONB;

-- Each component line can carry a quantity FORMULA (parametric expression) instead of
-- the fixed quantity_per_unit. When formula IS NOT NULL, it takes precedence.
-- Example: "perimetre_ss * 0.25 + 3" or "IF(surface_ss > 800, 3, 2)"
ALTER TABLE metre_product_components ADD COLUMN IF NOT EXISTS formula TEXT;

-- Labour-time estimate fields on composite BOMs. Populate per BOM in the
-- catalog (saved as default), overridable per project at devis time.
-- nb_hommes * nb_hrs_par_jour * nb_jours = total_hrs displayed in the
-- estimation TSV. Cost is total_hrs * a global hourly rate (stored client-side
-- in localStorage as a tenant-level setting; no DB column for the rate).
ALTER TABLE metre_products ADD COLUMN IF NOT EXISTS nb_hommes NUMERIC(6,2);
ALTER TABLE metre_products ADD COLUMN IF NOT EXISTS nb_hrs_par_jour NUMERIC(6,2);
ALTER TABLE metre_products ADD COLUMN IF NOT EXISTS nb_jours NUMERIC(6,2);

-- Sequential section number used in the estimation report (1-31 for the
-- standard residential template, free-form text for custom projects).
ALTER TABLE metre_products ADD COLUMN IF NOT EXISTS numero_section TEXT;

-- Reference to a CCQ labor trade in the client-side catalog. Stored as TEXT
-- (the trade id like 'ccq-charpentier-menuisier') -- no FK to a server table
-- because the labor catalog lives in localStorage on the frontend and is
-- editable per-user without backend persistence. The hourly rate associated
-- to this trade is resolved client-side at evaluation time.
ALTER TABLE metre_products ADD COLUMN IF NOT EXISTS labor_trade_id TEXT;

DO $$ BEGIN
  ALTER TABLE metre_products ADD CONSTRAINT chk_product_display_mode
    CHECK (display_mode IN ('detailed', 'summary'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- ============================================================================
-- AI Detections (takeoff IA via Claude Vision) - Round 6 SHOW-STOPPER fix:
-- aligned with metre_schema_sql.py to ensure lazy `_ensure_tables` path also
-- creates the AI tables/columns. Without this block, legacy tenants hitting
-- /ai-detect would 500 with `relation "metre_ai_detections" does not exist`.
-- ============================================================================

DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_metre_layers_doc_name
    ON metre_layers(document_id, name);
EXCEPTION
  WHEN unique_violation THEN
    RAISE WARNING 'metre_layers(document_id, name) has duplicates -- skipping unique index';
END $$;

CREATE TABLE IF NOT EXISTS metre_ai_detections (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES metre_documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL DEFAULT 0,
    detection_type VARCHAR(20) NOT NULL,
    category VARCHAR(50),
    label VARCHAR(255),
    points JSONB DEFAULT '[]'::jsonb,
    bounding_box JSONB,
    detected_value DOUBLE PRECISION,
    unit VARCHAR(10) DEFAULT 'pi.ca',
    confidence NUMERIC(4,3) DEFAULT 0.000,
    color VARCHAR(9) DEFAULT '#10B981',
    status VARCHAR(20) DEFAULT 'pending',
    user_correction_value DOUBLE PRECISION,
    measurement_id INTEGER,
    claude_model VARCHAR(50),
    claude_tokens_in INTEGER DEFAULT 0,
    claude_tokens_out INTEGER DEFAULT 0,
    claude_cost_usd NUMERIC(10,6) DEFAULT 0,
    claude_response JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metre_ai_detections_doc ON metre_ai_detections(document_id);
CREATE INDEX IF NOT EXISTS idx_metre_ai_detections_doc_page ON metre_ai_detections(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_metre_ai_detections_status ON metre_ai_detections(status);
CREATE INDEX IF NOT EXISTS idx_metre_ai_detections_measurement ON metre_ai_detections(measurement_id);

DO $$ BEGIN
  ALTER TABLE metre_ai_detections ADD CONSTRAINT chk_ai_detection_type
    CHECK (detection_type IN ('surface', 'distance', 'count'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_ai_detections ADD CONSTRAINT chk_ai_detection_status
    CHECK (status IN ('pending', 'accepted', 'rejected', 'corrected'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_ai_detections ADD CONSTRAINT chk_ai_confidence_range
    CHECK (confidence >= 0 AND confidence <= 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_ai_detections ADD CONSTRAINT chk_ai_color_format
    CHECK (color ~ '^#[0-9a-fA-F]{6}$' OR color ~ '^#[0-9a-fA-F]{8}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_ai_detections ADD CONSTRAINT chk_ai_page_positive
    CHECK (page_number >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metre_ai_detections
    ADD CONSTRAINT fk_ai_detection_measurement
    FOREIGN KEY (measurement_id) REFERENCES metre_measurements(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

ALTER TABLE metre_measurements ADD COLUMN IF NOT EXISTS ai_detection_id INTEGER;
ALTER TABLE metre_measurements ADD COLUMN IF NOT EXISTS devis_ligne_id INTEGER;

DO $$ BEGIN
  ALTER TABLE metre_measurements
    ADD CONSTRAINT fk_measurement_ai_detection
    FOREIGN KEY (ai_detection_id) REFERENCES metre_ai_detections(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_measurements_ai_detection ON metre_measurements(ai_detection_id);
CREATE INDEX IF NOT EXISTS idx_measurements_devis_ligne ON metre_measurements(devis_ligne_id);
"""


def _ensure_tables(schema: str) -> None:
    """Create metre_* tables in the tenant schema if not already ensured.

    Defense-in-depth (lecon #151): meme si init_database_for_tenant cree deja
    les tables au signup via metre_schema_sql.py, on garde ce path lazy pour
    rattraper les tenants legacy qui n'ont jamais vu metre_schema_sql.py +
    pour servir de fallback en cas d'echec partiel au signup.
    """
    if schema in _tables_ensured:
        return
    conn = db.get_conn()
    try:
        db.set_tenant(conn, schema)
        cursor = conn.cursor()
        cursor.execute(_CREATE_TABLES_SQL)
        conn.commit()
        cursor.close()
        _tables_ensured.add(schema)
        logger.info(f"[Metre PDF] Tables ensured for schema: {schema}")
    except Exception as exc:
        conn.rollback()
        _msg = str(exc).lower()
        if any(tok in _msg for tok in ("duplicate key", "pg_class_relname", "already exists")):
            # Benign race with a concurrent worker on a fresh tenant: another
            # process already created the same index/constraint. The SQL block
            # is idempotent (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
            # EXISTS, ALTER ... EXCEPTION WHEN duplicate_object), so by the
            # time we land here the schema is effectively ensured. Avoid
            # throwing a 500 back to the user in this case.
            logger.warning(f"[Metre PDF] DDL race for {schema}: {exc}")
            _tables_ensured.add(schema)
            return
        logger.error(f"[Metre PDF] Failed to ensure tables for {schema}: {exc}")
        raise HTTPException(status_code=500, detail="Erreur initialisation des tables metre")
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# =============================================================================
# DATABASE OPERATIONS
# =============================================================================

def _get_conn_for_tenant(schema: str):
    """Get a connection and set the search_path to the tenant schema."""
    conn = db.get_conn()
    db.set_tenant(conn, schema)
    return conn


# --- Projects ---

def _db_create_project(schema: str, data: dict, user_id: int) -> dict:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO metre_projects (name, description, company_id, devis_id, created_by)
               VALUES (%(name)s, %(description)s, %(company_id)s, %(devis_id)s, %(created_by)s)
               RETURNING *""",
            {
                'name': data.get('name'),
                'description': data.get('description'),
                'company_id': data.get('company_id'),
                'devis_id': data.get('devis_id'),
                'created_by': user_id,
            }
        )
        result = dict(cursor.fetchone())
        conn.commit()
        cursor.close()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_list_projects(schema: str) -> list[dict]:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """SELECT id, name, description, company_id, devis_id, created_by,
               created_at, updated_at
               FROM metre_projects ORDER BY updated_at DESC"""
        )
        result = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_get_project(schema: str, project_id: int) -> Optional[dict]:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM metre_projects WHERE id = %s", (project_id,))
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_update_project(schema: str, project_id: int, data: dict) -> Optional[dict]:
    fields = _validate_fields(data, ALLOWED_PROJECT_FIELDS, 'projet')
    if not fields:
        return _db_get_project(schema, project_id)
    set_clauses = ", ".join(f"{k} = %({k})s" for k in fields)
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE metre_projects SET {set_clauses}, updated_at = NOW() "
            f"WHERE id = %(id)s RETURNING *",
            {**fields, 'id': project_id}
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_list_metres_library(schema: str) -> list[dict]:
    """Aggregated view of all métrés (projects) for the library modal.

    Single query that joins projects with their primary document (most recent
    upload), measurement count and layer count. This avoids N+1 client-side.
    The optional `created_by_name` join uses the tenant-local `users` table
    (resolved via `search_path` → tenant_<slug>.users — NEVER `public.users`,
    which contains stale cross-tenant legacy data and would leak names from
    other tenants). Silent fallback to NULL only if the table or column is
    missing (UndefinedTable / UndefinedColumn). Other errors (permission
    denied, syntax bugs, etc.) re-raise to surface real deployment problems.
    """
    conn = _get_conn_for_tenant(schema)
    try:
        # Hard-qualify the schema for the users JOIN so we cannot fall
        # through `search_path` to `public.users` (which holds stale
        # cross-tenant legacy data and would leak names from other tenants).
        # `set_tenant` already validated `schema` via `validate_schema_name`,
        # but re-validate here as defense-in-depth in case this function
        # is ever called outside that path.
        if not db.validate_schema_name(schema):
            raise HTTPException(status_code=400, detail="Invalid tenant schema")
        cursor = conn.cursor()
        # Try the rich variant with users join first; fall back to the
        # name-less variant if the tenant `users` table or its `full_name`
        # column is missing.
        try:
            cursor.execute(
                f"""
                WITH primary_doc AS (
                    SELECT DISTINCT ON (project_id)
                           project_id, id, filename, original_filename, page_count
                    FROM metre_documents
                    ORDER BY project_id, uploaded_at DESC
                ),
                m_count AS (
                    SELECT d.project_id, COUNT(m.id) AS cnt
                    FROM metre_documents d
                    LEFT JOIN metre_measurements m ON m.document_id = d.id
                    GROUP BY d.project_id
                ),
                l_count AS (
                    SELECT d.project_id, COUNT(l.id) AS cnt
                    FROM metre_documents d
                    LEFT JOIN metre_layers l ON l.document_id = d.id
                    GROUP BY d.project_id
                ),
                doc_count AS (
                    SELECT project_id, COUNT(*) AS cnt
                    FROM metre_documents
                    GROUP BY project_id
                )
                SELECT p.id, p.name, p.description, p.devis_id,
                       p.created_by, p.created_at, p.updated_at,
                       u.full_name AS created_by_name,
                       COALESCE(mc.cnt, 0) AS measurement_count,
                       COALESCE(lc.cnt, 0) AS layer_count,
                       COALESCE(dc.cnt, 0) AS document_count,
                       pd.id AS primary_document_id,
                       pd.filename AS primary_document_filename,
                       pd.original_filename AS primary_document_original_filename,
                       pd.page_count AS primary_document_page_count
                FROM metre_projects p
                LEFT JOIN primary_doc pd ON pd.project_id = p.id
                LEFT JOIN m_count mc ON mc.project_id = p.id
                LEFT JOIN l_count lc ON lc.project_id = p.id
                LEFT JOIN doc_count dc ON dc.project_id = p.id
                LEFT JOIN "{schema}".users u ON u.id = p.created_by
                ORDER BY p.updated_at DESC
                """
            )
            return [dict(r) for r in cursor.fetchall()]
        except (psycopg2.errors.UndefinedTable, psycopg2.errors.UndefinedColumn) as join_err:
            # CRITICAL: NEVER fall back to `public.users` here — a stale
            # legacy `public.users` from earlier Streamlit migrations contains
            # CROSS-TENANT user data and would cause a data leak where tenant
            # A sees "created by Steve from tenant B" labels in the métré
            # library. The hard-qualified `"{schema}".users` JOIN above
            # cannot resolve to `public.users` — if the tenant schema is
            # missing the users table or its full_name column, we land here
            # and return NULL labels safely (rather than leaking).
            conn.rollback()
            logger.info(f"[Metre PDF] users join unavailable, falling back: {join_err}")
            cursor.execute(
                """
                WITH primary_doc AS (
                    SELECT DISTINCT ON (project_id)
                           project_id, id, filename, original_filename, page_count
                    FROM metre_documents
                    ORDER BY project_id, uploaded_at DESC
                ),
                m_count AS (
                    SELECT d.project_id, COUNT(m.id) AS cnt
                    FROM metre_documents d
                    LEFT JOIN metre_measurements m ON m.document_id = d.id
                    GROUP BY d.project_id
                ),
                l_count AS (
                    SELECT d.project_id, COUNT(l.id) AS cnt
                    FROM metre_documents d
                    LEFT JOIN metre_layers l ON l.document_id = d.id
                    GROUP BY d.project_id
                ),
                doc_count AS (
                    SELECT project_id, COUNT(*) AS cnt
                    FROM metre_documents
                    GROUP BY project_id
                )
                SELECT p.id, p.name, p.description, p.devis_id,
                       p.created_by, p.created_at, p.updated_at,
                       NULL::text AS created_by_name,
                       COALESCE(mc.cnt, 0) AS measurement_count,
                       COALESCE(lc.cnt, 0) AS layer_count,
                       COALESCE(dc.cnt, 0) AS document_count,
                       pd.id AS primary_document_id,
                       pd.filename AS primary_document_filename,
                       pd.original_filename AS primary_document_original_filename,
                       pd.page_count AS primary_document_page_count
                FROM metre_projects p
                LEFT JOIN primary_doc pd ON pd.project_id = p.id
                LEFT JOIN m_count mc ON mc.project_id = p.id
                LEFT JOIN l_count lc ON lc.project_id = p.id
                LEFT JOIN doc_count dc ON dc.project_id = p.id
                ORDER BY p.updated_at DESC
                """
            )
            return [dict(r) for r in cursor.fetchall()]
        finally:
            cursor.close()
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_delete_project(schema: str, project_id: int) -> bool:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM metre_projects WHERE id = %s", (project_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        cursor.close()
        return deleted
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# --- Documents ---

# Columns returned for "metadata-only" reads (list, get_document for non-download
# paths). Excludes `file_data` (BYTEA) which can be tens of MB and would bloat
# every metadata response. Use `_db_get_document_data` when you actually need
# the bytes (download endpoint).
_DOC_METADATA_COLS = (
    "id, project_id, filename, original_filename, page_count, "
    "file_size_bytes, uploaded_at, mime_type, "
    "(file_data IS NOT NULL) AS has_file_data"
)


def _db_create_document(schema: str, project_id: int, data: dict, file_bytes: bytes | None = None) -> dict:
    """Insert a new metre_documents row.

    `file_bytes` is the raw PDF/image content. When provided, it is stored
    in the `file_data` BYTEA column so the file survives Render redeploys
    (ephemeral filesystem). When None, only metadata is inserted — useful
    for tests or for tenants in transition where the file lives on disk.
    """
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        # `psycopg2.Binary` wraps the bytes so they're sent over the wire as
        # a proper BYTEA literal (not a UTF-8 string).
        from psycopg2 import Binary
        cursor.execute(
            f"""INSERT INTO metre_documents
                (project_id, filename, original_filename, page_count, file_size_bytes,
                 file_data, mime_type)
                VALUES (%(project_id)s, %(filename)s, %(original_filename)s,
                        %(page_count)s, %(file_size_bytes)s, %(file_data)s,
                        %(mime_type)s)
                RETURNING {_DOC_METADATA_COLS}""",
            {
                'project_id': project_id,
                **data,
                'file_data': Binary(file_bytes) if file_bytes is not None else None,
                'mime_type': data.get('mime_type', 'application/pdf'),
            }
        )
        result = dict(cursor.fetchone())
        conn.commit()
        cursor.close()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_get_document(schema: str, document_id: int) -> Optional[dict]:
    """Return document metadata WITHOUT the BYTEA payload (lightweight)."""
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT {_DOC_METADATA_COLS} FROM metre_documents WHERE id = %s",
            (document_id,),
        )
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_get_document_data(schema: str, document_id: int) -> Optional[bytes]:
    """Return the raw BYTEA file_data for a document (or None if NULL/missing).

    Kept separate from `_db_get_document` to avoid loading a multi-MB blob on
    every metadata request. Callers that need the binary call this after they
    have validated authorisation via `_db_get_document`.
    """
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT file_data FROM metre_documents WHERE id = %s", (document_id,))
        row = cursor.fetchone()
        cursor.close()
        if not row:
            return None
        data = row['file_data'] if isinstance(row, dict) else row[0]
        if data is None:
            return None
        # psycopg2 returns BYTEA as `memoryview` — convert to plain bytes for
        # downstream code (StreamingResponse, hash, etc.).
        return bytes(data)
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_list_documents(schema: str, project_id: int) -> list[dict]:
    """List documents for a project — metadata only, never the BYTEA payload."""
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT {_DOC_METADATA_COLS} FROM metre_documents "
            "WHERE project_id = %s ORDER BY uploaded_at DESC",
            (project_id,)
        )
        result = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_delete_document(schema: str, document_id: int) -> bool:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM metre_documents WHERE id = %s", (document_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        cursor.close()
        return deleted
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# --- Calibrations ---

def _db_upsert_calibration(schema: str, document_id: int, data: dict) -> dict:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO metre_calibrations
               (document_id, page_number, scale_factor, unit, reference_length, pixel_length)
               VALUES (%(document_id)s, %(page_number)s, %(scale_factor)s,
                       %(unit)s, %(reference_length)s, %(pixel_length)s)
               ON CONFLICT (document_id, page_number)
               DO UPDATE SET
                   scale_factor = EXCLUDED.scale_factor,
                   unit = EXCLUDED.unit,
                   reference_length = EXCLUDED.reference_length,
                   pixel_length = EXCLUDED.pixel_length,
                   updated_at = NOW()
               RETURNING *""",
            {'document_id': document_id, **data}
        )
        result = dict(cursor.fetchone())
        conn.commit()
        cursor.close()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_get_calibration(schema: str, document_id: int, page_number: int) -> Optional[dict]:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM metre_calibrations WHERE document_id = %s AND page_number = %s",
            (document_id, page_number)
        )
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# --- Measurements ---

def _deserialize_jsonb_fields(row: dict) -> dict:
    """Decode points and metadata_json from JSONB strings if needed (psycopg2 returns dict on native, str on legacy)."""
    if row.get('points') and isinstance(row['points'], str):
        try:
            row['points'] = json.loads(row['points'])
        except (ValueError, TypeError):
            row['points'] = []
    if row.get('metadata_json') and isinstance(row['metadata_json'], str):
        try:
            row['metadata_json'] = json.loads(row['metadata_json'])
        except (ValueError, TypeError):
            row['metadata_json'] = {}
    if row.get('metadata_json') is None:
        row['metadata_json'] = {}
    return row


def _db_create_measurement(schema: str, document_id: int, data: dict) -> dict:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        points_json = json.dumps(data.get('points', []))
        metadata_json = json.dumps(data.get('metadata_json') or {})
        cursor.execute(
            """INSERT INTO metre_measurements
               (document_id, page_number, type, label, value, unit, points, color,
                layer_id, product_id, quantity, metadata_json)
               VALUES (%(document_id)s, %(page_number)s, %(type)s, %(label)s,
                       %(value)s, %(unit)s, %(points)s, %(color)s, %(layer_id)s,
                       %(product_id)s, %(quantity)s, %(metadata_json)s)
               RETURNING *""",
            {
                'document_id': document_id,
                'points': points_json,
                'metadata_json': metadata_json,
                **{k: data.get(k) for k in [
                    'page_number', 'type', 'label', 'value', 'unit', 'color',
                    'layer_id', 'product_id', 'quantity',
                ]}
            }
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="INSERT metre_measurements n'a pas retourne d'id")
        result = _deserialize_jsonb_fields(dict(row))
        conn.commit()
        cursor.close()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_list_measurements(
    schema: str,
    document_id: int,
    page_number: Optional[int] = None,
    layer_id: Optional[int] = None,
) -> list[dict]:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        query = "SELECT * FROM metre_measurements WHERE document_id = %s"
        params: list[Any] = [document_id]
        if page_number is not None:
            query += " AND page_number = %s"
            params.append(page_number)
        if layer_id is not None:
            query += " AND layer_id = %s"
            params.append(layer_id)
        query += " ORDER BY created_at ASC"
        cursor.execute(query, params)
        results = [_deserialize_jsonb_fields(dict(r)) for r in cursor.fetchall()]
        cursor.close()
        return results
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_get_measurement(schema: str, measurement_id: int) -> Optional[dict]:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM metre_measurements WHERE id = %s", (measurement_id,))
        row = cursor.fetchone()
        cursor.close()
        if row:
            return _deserialize_jsonb_fields(dict(row))
        return None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_update_measurement(schema: str, measurement_id: int, data: dict) -> Optional[dict]:
    fields = _validate_fields(data, ALLOWED_MEASUREMENT_FIELDS, 'mesure')
    if 'points' in fields:
        fields['points'] = json.dumps(fields['points'])
    if 'metadata_json' in fields:
        fields['metadata_json'] = json.dumps(fields['metadata_json'] or {})
    if not fields:
        return _db_get_measurement(schema, measurement_id)
    set_clauses = ", ".join(f"{k} = %({k})s" for k in fields)
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE metre_measurements SET {set_clauses}, updated_at = NOW() "
            f"WHERE id = %(id)s RETURNING *",
            {**fields, 'id': measurement_id}
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        if row:
            return _deserialize_jsonb_fields(dict(row))
        return None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_delete_measurement(schema: str, measurement_id: int) -> bool:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM metre_measurements WHERE id = %s", (measurement_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        cursor.close()
        return deleted
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_get_measurement_summary(schema: str, document_id: int) -> dict:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) as total FROM metre_measurements WHERE document_id = %s",
            (document_id,)
        )
        total = cursor.fetchone()['total']

        cursor.execute(
            """SELECT type, unit, COUNT(*) as count, SUM(value) as total_value
               FROM metre_measurements
               WHERE document_id = %s
               GROUP BY type, unit
               ORDER BY type""",
            (document_id,)
        )
        by_type = [dict(r) for r in cursor.fetchall()]

        cursor.execute(
            """SELECT m.type, l.name as layer_name, m.unit,
                      COUNT(*) as count, SUM(m.value) as total_value
               FROM metre_measurements m
               LEFT JOIN metre_layers l ON m.layer_id = l.id
               WHERE m.document_id = %s
               GROUP BY m.type, l.name, m.unit
               ORDER BY l.name, m.type""",
            (document_id,)
        )
        by_layer = [dict(r) for r in cursor.fetchall()]
        cursor.close()

        return {
            'document_id': document_id,
            'total_measurements': total,
            'by_type': by_type,
            'by_layer': by_layer,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# --- Layers ---

def _validate_composite_id_or_raise(cursor, composite_id) -> None:
    """P3.4: Verifie qu'un composite_id pointe vers un produit existant et
    is_composite=true dans le tenant courant.

    Sans cette validation, un client peut envoyer un composite_id arbitraire
    (id d'un autre tenant, id de produit non-composite) qui sera stocke tel
    quel et creera un etat corrompu silencieusement (dangling reference, vue
    'composite supprime' cote UI). Le search_path tenant garantit que le SELECT
    ne voit que les produits du schema courant -- on ne peut donc pas faire
    fuiter d'info inter-tenant via cette validation.
    """
    if composite_id is None:
        return
    cursor.execute(
        "SELECT is_composite FROM metre_products WHERE id = %s",
        (composite_id,),
    )
    row = cursor.fetchone()
    if not row:
        raise HTTPException(
            status_code=400,
            detail=f"composite_id {composite_id} introuvable dans ce tenant",
        )
    if not row.get('is_composite'):
        raise HTTPException(
            status_code=400,
            detail=(
                f"composite_id {composite_id} ne pointe pas vers un produit "
                "composite (is_composite=False)"
            ),
        )


def _db_create_layer(schema: str, document_id: int, data: dict) -> dict:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        _validate_composite_id_or_raise(cursor, data.get('composite_id'))
        composite_inputs_raw = _validate_composite_inputs_size(
            data.get('composite_inputs')
        )
        composite_inputs_json = (
            json.dumps(composite_inputs_raw)
            if composite_inputs_raw is not None
            else None
        )
        cursor.execute(
            """INSERT INTO metre_layers
               (document_id, name, color, visible, locked,
                composite_id, composite_inputs)
               VALUES (%(document_id)s, %(name)s, %(color)s, %(visible)s,
                       %(locked)s, %(composite_id)s, %(composite_inputs)s)
               RETURNING *""",
            {
                'document_id': document_id,
                'name': data.get('name'),
                'color': data.get('color', '#0000FF'),
                'visible': data.get('visible', True),
                'locked': data.get('locked', False),
                'composite_id': data.get('composite_id'),
                'composite_inputs': composite_inputs_json,
            }
        )
        result = dict(cursor.fetchone())
        conn.commit()
        cursor.close()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_list_layers(schema: str, document_id: int) -> list[dict]:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM metre_layers WHERE document_id = %s ORDER BY id",
            (document_id,)
        )
        result = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_get_layer(schema: str, layer_id: int) -> Optional[dict]:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM metre_layers WHERE id = %s", (layer_id,))
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_update_layer(schema: str, layer_id: int, data: dict) -> Optional[dict]:
    fields = _validate_fields(data, ALLOWED_LAYER_FIELDS, 'calque')
    if not fields:
        return _db_get_layer(schema, layer_id)
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        # P3.4 : valider composite_id apres ouverture du cursor (search_path
        # tenant deja set par _get_conn_for_tenant). Si invalide, raise avant
        # le UPDATE -- le finally rollback proprement.
        if 'composite_id' in fields:
            _validate_composite_id_or_raise(cursor, fields['composite_id'])
        # Serialize JSONB columns (psycopg2 doesn't auto-adapt dict to JSONB).
        if 'composite_inputs' in fields and fields['composite_inputs'] is not None:
            _validate_composite_inputs_size(fields['composite_inputs'])
            fields['composite_inputs'] = json.dumps(fields['composite_inputs'])
        set_clauses = ", ".join(f"{k} = %({k})s" for k in fields)
        cursor.execute(
            f"UPDATE metre_layers SET {set_clauses} WHERE id = %(id)s RETURNING *",
            {**fields, 'id': layer_id}
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_delete_layer(schema: str, layer_id: int) -> bool:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE metre_measurements SET layer_id = NULL WHERE layer_id = %s",
            (layer_id,)
        )
        cursor.execute("DELETE FROM metre_layers WHERE id = %s", (layer_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        cursor.close()
        return deleted
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# =============================================================================
# AI DETECTIONS - DB HELPERS
# =============================================================================

def _db_create_ai_detection(
    schema: str,
    document_id: int,
    page_number: int,
    detection: dict,
    claude_model: str,
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
    claude_response: Optional[dict] = None,
    img_w: Optional[int] = None,
    img_h: Optional[int] = None,
) -> dict:
    """INSERT une detection IA (status='pending'). Retourne la row inseree.

    Si img_w/img_h fournis, clippe les coordonnees de points et bounding_box
    pour rester dans le range [0, img_w] x [0, img_h]. Defensif contre les
    hallucinations Claude qui retourneraient des coords dans la zone paddee
    (multiple de 28 px) hors-PDF.
    """
    # Clipping defensif si dimensions image fournies
    if img_w is not None and img_h is not None and img_w > 0 and img_h > 0:
        det = dict(detection)  # shallow copy
        # Clip points
        pts = det.get('points', [])
        if isinstance(pts, list):
            clipped_pts = []
            for p in pts:
                if isinstance(p, dict):
                    x = p.get('x', 0)
                    y = p.get('y', 0)
                    try:
                        cx = max(0.0, min(float(img_w), float(x)))
                        cy = max(0.0, min(float(img_h), float(y)))
                        clipped_pts.append({'x': cx, 'y': cy})
                    except (TypeError, ValueError):
                        clipped_pts.append({'x': 0.0, 'y': 0.0})
                else:
                    clipped_pts.append({'x': 0.0, 'y': 0.0})
            det['points'] = clipped_pts
        # Clip bounding_box
        bb = det.get('bounding_box')
        if isinstance(bb, dict):
            try:
                bx = max(0.0, min(float(img_w), float(bb.get('x', 0))))
                by = max(0.0, min(float(img_h), float(bb.get('y', 0))))
                bw = max(0.0, min(float(img_w) - bx, float(bb.get('w', 0))))
                bh = max(0.0, min(float(img_h) - by, float(bb.get('h', 0))))
                det['bounding_box'] = {'x': bx, 'y': by, 'w': bw, 'h': bh}
            except (TypeError, ValueError):
                det['bounding_box'] = None
        detection = det  # use clipped version below

    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO metre_ai_detections
              (document_id, page_number, detection_type, category, label,
               points, bounding_box, detected_value, unit, confidence, color,
               claude_model, claude_tokens_in, claude_tokens_out,
               claude_cost_usd, claude_response, status)
            VALUES (%s, %s, %s, %s, %s,
                    %s::jsonb, %s::jsonb, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s::jsonb, 'pending')
            RETURNING *
            """,
            (
                document_id, page_number,
                detection.get('detection_type'),
                detection.get('category'),
                detection.get('label'),
                json.dumps(detection.get('points', [])),
                json.dumps(detection.get('bounding_box')) if detection.get('bounding_box') else None,
                detection.get('detected_value'),
                detection.get('unit', 'pi.ca'),
                detection.get('confidence', 0.0),
                detection.get('color', '#10B981'),
                claude_model, tokens_in, tokens_out, cost_usd,
                json.dumps(claude_response) if claude_response else None,
            ),
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return _deserialize_ai_detection_fields(dict(row)) if row else {}
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _clip_detection_coords(
    detection: dict,
    img_w: Optional[int],
    img_h: Optional[int],
) -> dict:
    """Clippe points et bounding_box dans [0, img_w] x [0, img_h]. Defensif
    contre les hallucinations Claude qui retourneraient des coords hors-PDF.

    Retourne une copie clippe (n'altere pas l'original).
    """
    if img_w is None or img_h is None or img_w <= 0 or img_h <= 0:
        return detection
    det = dict(detection)  # shallow copy
    pts = det.get('points', [])
    if isinstance(pts, list):
        clipped_pts = []
        for p in pts:
            if isinstance(p, dict):
                x = p.get('x', 0)
                y = p.get('y', 0)
                try:
                    cx = max(0.0, min(float(img_w), float(x)))
                    cy = max(0.0, min(float(img_h), float(y)))
                    clipped_pts.append({'x': cx, 'y': cy})
                except (TypeError, ValueError):
                    clipped_pts.append({'x': 0.0, 'y': 0.0})
            else:
                clipped_pts.append({'x': 0.0, 'y': 0.0})
        det['points'] = clipped_pts
    bb = det.get('bounding_box')
    if isinstance(bb, dict):
        try:
            bx = max(0.0, min(float(img_w), float(bb.get('x', 0))))
            by = max(0.0, min(float(img_h), float(bb.get('y', 0))))
            bw = max(0.0, min(float(img_w) - bx, float(bb.get('w', 0))))
            bh = max(0.0, min(float(img_h) - by, float(bb.get('h', 0))))
            det['bounding_box'] = {'x': bx, 'y': by, 'w': bw, 'h': bh}
        except (TypeError, ValueError):
            det['bounding_box'] = None
    return det


def _db_create_ai_detections_bulk(
    schema: str,
    document_id: int,
    page_number: int,
    detections_raw: list[dict],
    claude_model: str,
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
    img_w: Optional[int] = None,
    img_h: Optional[int] = None,
    claude_response_builder: Optional[callable] = None,
) -> list[dict]:
    """INSERT bulk des detections IA dans UNE seule transaction (status='pending').

    Atomicite : une seule connexion, un seul commit. Si TOUTES les INSERTs
    echouent, rollback global. Si certaines parsent mal (champ manquant, etc.)
    on log et on skip celles-la mais on commit les autres -- best-effort dans
    la meme transaction. Evite l'etat incoherent du Fix#2 (billing paye +
    detections partielles si worker crash mid-loop).

    SAVEPOINT par detection : permet de skip une detection individuelle (CHECK
    constraint violation, ex: confidence>1 d'une hallucination Claude) sans
    aborter la transaction globale. Sans SAVEPOINT, la 1ere erreur empoisonne
    toute la batch (InFailedSqlTransaction sur tous les INSERTs suivants),
    resultat : saved=[] alors que les credits sont deja deduits cote billing.

    `claude_response_builder` (optionnel) : callable(det) -> dict, permet
    d'enrichir claude_response avec section/layer_id. Defaut: {"raw": det}.

    Retourne la liste des rows inserees (deserialisees).
    """
    if not detections_raw:
        return []

    builder = claude_response_builder or (lambda d: {"raw": d})

    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        saved: list[dict] = []
        for det in detections_raw:
            try:
                cursor.execute("SAVEPOINT sp_det")
                try:
                    clipped = _clip_detection_coords(det, img_w, img_h)
                    cursor.execute(
                        """
                        INSERT INTO metre_ai_detections
                          (document_id, page_number, detection_type, category, label,
                           points, bounding_box, detected_value, unit, confidence, color,
                           claude_model, claude_tokens_in, claude_tokens_out,
                           claude_cost_usd, claude_response, status)
                        VALUES (%s, %s, %s, %s, %s,
                                %s::jsonb, %s::jsonb, %s, %s, %s, %s,
                                %s, %s, %s,
                                %s, %s::jsonb, 'pending')
                        RETURNING *
                        """,
                        (
                            document_id, page_number,
                            clipped.get('detection_type'),
                            clipped.get('category'),
                            clipped.get('label'),
                            json.dumps(clipped.get('points', [])),
                            json.dumps(clipped.get('bounding_box'))
                                if clipped.get('bounding_box') else None,
                            clipped.get('detected_value'),
                            clipped.get('unit', 'pi.ca'),
                            clipped.get('confidence', 0.0),
                            clipped.get('color', '#10B981'),
                            claude_model, tokens_in, tokens_out, cost_usd,
                            json.dumps(builder(clipped)),
                        ),
                    )
                    row = cursor.fetchone()
                    if row:
                        saved.append(_deserialize_ai_detection_fields(dict(row)))
                    cursor.execute("RELEASE SAVEPOINT sp_det")
                except Exception:
                    # Parse/format-error ou CHECK constraint sur UNE detection :
                    # rollback du SAVEPOINT (la transaction globale reste utilisable),
                    # log + skip, on continue avec les autres.
                    cursor.execute("ROLLBACK TO SAVEPOINT sp_det")
                    logger.exception(
                        "Failed to persist AI detection (bulk, skipping)"
                    )
            except Exception:
                # Erreur catastrophique sur SAVEPOINT lui-meme (rare, ex: connexion
                # morte) -- laisse l'except global ci-dessous gerer le rollback.
                logger.exception("SAVEPOINT operation failed catastrophically")
                raise
        if not saved and detections_raw:
            # Toutes ont echoue : rollback (rien a commit de toutes facons,
            # mais on libere les locks proprement).
            conn.rollback()
        else:
            conn.commit()
        cursor.close()
        return saved
    except Exception:
        # Erreur non-rattrappee (connexion morte, etc.) -> rollback global,
        # rien n'est persiste (etat coherent).
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _deserialize_ai_detection_fields(row: dict) -> dict:
    """Decode points and bounding_box and claude_response if returned as strings."""
    if row.get('points') and isinstance(row['points'], str):
        try:
            row['points'] = json.loads(row['points'])
        except (ValueError, TypeError):
            row['points'] = []
    if row.get('bounding_box') and isinstance(row['bounding_box'], str):
        try:
            row['bounding_box'] = json.loads(row['bounding_box'])
        except (ValueError, TypeError):
            row['bounding_box'] = None
    if row.get('claude_response') and isinstance(row['claude_response'], str):
        try:
            row['claude_response'] = json.loads(row['claude_response'])
        except (ValueError, TypeError):
            row['claude_response'] = None
    # confidence is NUMERIC(4,3) -> Decimal; cast to float for Pydantic
    if row.get('confidence') is not None:
        try:
            row['confidence'] = float(row['confidence'])
        except (TypeError, ValueError):
            pass
    if row.get('claude_cost_usd') is not None:
        try:
            row['claude_cost_usd'] = float(row['claude_cost_usd'])
        except (TypeError, ValueError):
            pass
    return row


def _db_list_ai_detections(
    schema: str,
    document_id: int,
    page_number: Optional[int] = None,
    status: Optional[str] = None,
) -> list[dict]:
    """List detections IA filtrees."""
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        sql = "SELECT * FROM metre_ai_detections WHERE document_id = %s"
        params: list[Any] = [document_id]
        if page_number is not None:
            sql += " AND page_number = %s"
            params.append(page_number)
        if status:
            sql += " AND status = %s"
            params.append(status)
        sql += " ORDER BY id DESC"
        cursor.execute(sql, params)
        rows = cursor.fetchall()
        cursor.close()
        return [_deserialize_ai_detection_fields(dict(r)) for r in rows]
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_get_ai_detection(schema: str, detection_id: int) -> Optional[dict]:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM metre_ai_detections WHERE id = %s", (detection_id,))
        row = cursor.fetchone()
        cursor.close()
        return _deserialize_ai_detection_fields(dict(row)) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_update_ai_detection_status(
    schema: str,
    detection_id: int,
    status: str,
    user_correction_value: Optional[float] = None,
    measurement_id: Optional[int] = None,
) -> Optional[dict]:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE metre_ai_detections
            SET status = %s,
                user_correction_value = COALESCE(%s, user_correction_value),
                measurement_id = COALESCE(%s, measurement_id),
                updated_at = NOW()
            WHERE id = %s
            RETURNING *
            """,
            (status, user_correction_value, measurement_id, detection_id),
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return _deserialize_ai_detection_fields(dict(row)) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# =============================================================================
# AI DETECTION - VISION HELPERS
# =============================================================================

def _render_page_for_vision(
    pdf_bytes: bytes,
    page_number: int,
    dpi: int = 250,
) -> tuple[bytes, int, int]:
    """Rend une page PDF en PNG haute resolution pour Claude Vision.

    Optimise pour Claude Opus 4.7 (max 2576 px sur le long edge, 4784 tokens).
    AMELIORATION 3: DPI 250 (vs 200) pour meilleure lisibilite des plans
    manuscrits. L'auto-clamp existant garantit long_edge <= 2576 px.
    - Letter portrait (8.5x11"): 250 DPI -> clamp ~234 effective -> 1989x2574 px
    - Letter landscape (11x8.5"): meme clamp.
    Auto-clamp a max effective DPI pour eviter le resize automatique cote API.

    Returns (png_bytes, width_px, height_px) pour permettre au caller de
    valider/clipper les coordonnees retournees par Claude (qui sont dans
    l'espace de l'image rendue, eventuellement paddee a multiple de 28 px).
    """
    if not _HAS_FITZ:
        raise HTTPException(status_code=500, detail="PyMuPDF (fitz) non installe")
    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        # Round 15 fix: ERP_REACT convention is 1-based pageNumber (matches
        # CalibrationModal). PyMuPDF is 0-based. Convert here.
        fitz_page_index = max(0, page_number - 1)
        page = pdf_doc[fitz_page_index]
        # Auto-clamp DPI to keep long edge under 2576 px (Opus 4.7 native res).
        # PDF default = 72 DPI. zoom factor = dpi / 72.
        page_w = page.rect.width  # in PDF points (1/72 inch)
        page_h = page.rect.height
        long_edge_pt = max(page_w, page_h)
        # max_dpi to stay under 2576 px on long edge: 2576 / (long_edge_pt/72)
        if long_edge_pt > 0:
            max_dpi = int(2576 * 72 / long_edge_pt)
            effective_dpi = min(dpi, max(72, max_dpi))
        else:
            effective_dpi = dpi
        zoom = effective_dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        return pix.tobytes("png"), pix.width, pix.height
    finally:
        pdf_doc.close()


# =============================================================================
# ANTHROPIC FILES API (BETA) - PNG upload reuse for multi-section
# =============================================================================

def _anthropic_client_for_files():
    """Get an Anthropic client for Files API operations."""
    from anthropic import Anthropic
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return Anthropic(api_key=api_key)


def _upload_png_to_anthropic(png_bytes: bytes) -> Optional[str]:
    """Upload PNG to Anthropic Files API (beta). Returns file_id or None on failure.

    Used by multi-section to avoid resending the same PNG N times.
    Best-effort: if upload fails, caller falls back to base64 inline.
    """
    try:
        import io as _io
        client = _anthropic_client_for_files()
        bio = _io.BytesIO(png_bytes)
        bio.name = 'metre_page.png'
        upload = client.beta.files.upload(
            file=('metre_page.png', bio, 'image/png'),
        )
        return upload.id
    except Exception:
        logger.exception("Files API upload failed (will fallback to base64)")
        return None


def _delete_anthropic_file(file_id: str) -> None:
    """Best-effort cleanup of an uploaded Anthropic file. Non-critical."""
    if not file_id:
        return
    try:
        client = _anthropic_client_for_files()
        client.beta.files.delete(file_id)
    except Exception:
        logger.warning("Files API delete failed for %s (non-critical)", file_id)


def _call_claude_vision_with_file(
    file_id: str,
    prompt: str,
    max_tokens: int = 32000,
):
    """Call Claude Vision using Files API (beta). Synchronous - wrap in to_thread."""
    client = _anthropic_client_for_files()
    return client.beta.messages.create(
        model="claude-opus-4-7",
        max_tokens=max_tokens,
        betas=["files-api-2025-04-14"],
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "file", "file_id": file_id}},
                {"type": "text", "text": prompt},
            ],
        }],
    )


def _format_bom_for_prompt(products: list[dict], max_items: int = 50) -> str:
    """Format a BOM products list as a compact text block for Claude prompt.

    Limited to `max_items` to avoid token explosion. Each product is one line.
    """
    if not products:
        return ""
    truncated = products[:max_items]
    lines = []
    for p in truncated:
        name = (p.get('name') or '')[:80]
        cat = (p.get('category') or '')[:40]
        unit = p.get('price_unit') or ''
        dims = (p.get('dimensions') or '')[:40]
        line = f"  - id={p['id']} | {name} | unit={unit}"
        if cat:
            line += f" | cat={cat}"
        if dims:
            line += f" | dims={dims}"
        lines.append(line)
    suffix = ""
    if len(products) > max_items:
        suffix = f"\n  ... ({len(products) - max_items} produits supplementaires non listes)"
    return "\n".join(lines) + suffix


def _build_metre_vision_prompt(
    scale_factor: float,
    unit: str,
    detection_types: list[str],
    additional_context: Optional[str] = None,
    bom_products: Optional[list[dict]] = None,
    section_label: Optional[str] = None,
    img_w: Optional[int] = None,
    img_h: Optional[int] = None,
) -> str:
    """Construit le prompt expert takeoff pour Claude Vision.

    PHASE 2: si `bom_products` est fourni, le catalogue BOM est injecte dans
    le prompt et Claude doit detecter UNIQUEMENT ces produits avec un
    `product_id` correspondant.

    Si img_w/img_h fournis, ajoute une mention des dimensions de l'image
    pour informer Claude que toutes les coordonnees doivent etre dans ce range.
    """
    types_str = ", ".join(detection_types)
    ctx = f"\n\nContexte additionnel: {additional_context}" if additional_context else ""

    # PHASE 2: inject BOM catalog if provided
    bom_block = ""
    if bom_products:
        bom_text = _format_bom_for_prompt(bom_products, max_items=50)
        section_hdr = f" - SECTION {section_label}" if section_label else ""
        bom_block = (
            f"\n\nCATALOGUE BOM TENANT{section_hdr} (detecte UNIQUEMENT ces produits):\n"
            f"{bom_text}\n\n"
            "Pour chaque detection, AJOUTE le champ \"product_id\" (number) qui pointe "
            "vers le produit BOM correspondant.\n"
            "Si tu detectes un element qui n'est dans AUCUN produit ci-dessus, "
            "NE l'inclus PAS dans ta reponse."
        )

    # Image dimensions hint (defensif: evite que Claude retourne des coords dans
    # la zone paddee a multiple de 28 px hors-PDF).
    dims_block = ""
    if img_w is not None and img_h is not None and img_w > 0 and img_h > 0:
        dims_block = (
            f"\n\nIMPORTANT - DIMENSIONS IMAGE: L'image fait {img_w}x{img_h} pixels. "
            f"Toutes les coordonnees (points et bounding_box) doivent etre dans le range "
            f"[0, {img_w}] x [0, {img_h}]. Aucune coordonnee hors de ces bornes."
        )

    return f"""Tu es un expert en takeoff (metre) de plans de construction au Quebec/CCQ.
Analyse ce plan PDF (rendu PNG, echelle: 1 pixel = {1/scale_factor:.4f} {unit}).{dims_block}

Detecte EXHAUSTIVEMENT et avec PRECISION les types suivants: {types_str}.

Pour chaque detection, fournis :
- detection_type: "surface" | "distance" | "count"
- category: door | window | outlet_110v | outlet_220v | light | switch | thermostat | smoke_detector | wall | floor | ceiling | roof | molding | pipe | other
- label: nom court FRANCAIS (max 50 chars), ex: "Porte entree", "Plancher RDC"
- points: liste de coordonnees [{{"x": X, "y": Y}}, ...] en PIXELS sur l'image (pour surface = polygone, distance = polyligne, count = position centre)
- bounding_box: {{"x": int, "y": int, "w": int, "h": int}} (rectangle englobant)
- detected_value: valeur DEJA convertie en unite reelle (multiplie pixels par scale_factor selon le type)
- unit: "pi.ca" pour surfaces, "pi.li" pour longueurs, "un" pour comptages
- confidence: 0.0 a 1.0 (sois HONNETE: 0.9+ certain, 0.7-0.9 probable, <0.7 incertain)
- color: hex selon categorie:
    * Portes: #10B981 (vert)
    * Fenetres: #F59E0B (jaune)
    * Prises: #EC4899 (rose)
    * Luminaires: #FBBF24 (jaune dore)
    * Murs: #6B7280 (gris)
    * Planchers: #3B82F6 (bleu)
    * Plafonds/toits: #8B5CF6 (violet)
    * Moulures/conduits: #06B6D4 (cyan)
    * Autres: #9CA3AF (gris clair)
- product_id: (optionnel, number) si correspond a un produit du catalogue BOM ci-dessous{bom_block}

IMPORTANT - DIMENSIONS:
- Lis CHAQUE callout/annotation dimensionnel pres de l'element (ex: "36\"x54\"", "62x54", "2'-6\" x 4'-0\"")
- Inclus la dimension dans le `label`. Format: "Fenetre 36x54" ou "Plancher RDC 14x11"
- Si aucune dimension visible, mets juste le nom court

COMPTAGE PRECIS:
- DISTINCTION CRITIQUE entre annotation PDF et instruction utilisateur:
  * "2X" / "x2" / "(2)" ANNOTE SUR LE PLAN PDF a cote d'un symbole = 2 unites identiques (ex: paire de fenetres jumelees). detected_value = 2.
  * "Verifier 2 fois", "verifie 2X", "double-check" dans le CONTEXTE UTILISATEUR (additional_context) = INSTRUCTION DE RIGUEUR, pas un multiplicateur. NE multiplie RIEN. Prends juste plus de soin dans ton analyse.
- Si plusieurs symboles identiques alignes (ex: 3 fenetres en serie), compte chacun separement (une detection par symbole avec detected_value=1)
- detected_value = quantite REELLE visible sur le plan (1 symbole = 1, sauf si annotation "2X" PDF a cote)

RIGUEUR (DOUBLE-CHECK INTERNE OBLIGATOIRE):
- AVANT de finaliser le JSON, RELIS ta liste de detections et verifie 2 fois:
  (a) Chaque detection a-t-elle des coordonnees DIFFERENTES (pas empilees au meme endroit)?
  (b) Chaque dimension extraite (label) correspond-elle a une annotation reellement visible sur le plan?
  (c) As-tu oublie un symbole evident? (compte les fenetres/portes/prises sur le plan, compare avec ta liste)
  (d) detected_value reflete-t-il la quantite VISIBLE (1 symbole = 1, sauf annotation "2X" sur le plan)?
- Si tu detectes une incoherence, CORRIGE avant de retourner le JSON final.

ZONES (si additional_context mentionne):
- Si l'utilisateur a precise "agrandissement seulement" ou "existant seulement", IGNORE l'autre zone
- Marqueurs typiques de zone: lignes en pointille = nouvelle construction, lignes pleines = existant
- Annotations "EXISTANT", "NOUVEAU", "AGRANDISSEMENT", "PHASE 1", "PHASE 2" indiquent la zone
- Ne retourne AUCUNE detection pour la zone exclue

COORDONNEES OBLIGATOIRES:
- Pour count: points = [{{"x": X, "y": Y}}] = position EXACTE du centre du symbole sur l'image
- Pour distance: points = polyligne suivant l'element (au moins 2 points)
- Pour surface: points = polygone du contour exterieur (au moins 3 points)
- JAMAIS centrer toutes les detections au meme endroit. Chaque element a sa propre position distincte.
- bounding_box doit englober UNIQUEMENT le symbole detecte, pas la page entiere.

TEXTES ET CALLOUTS:
- Lis tous les textes manuscrits ou imprimes du plan (cotes, notes, etiquettes)
- Utilise ces textes pour identifier le type exact (ex: "F1", "F-101", "Fenetre guillotine 36x54")
- Inclus les codes/references dans le label si visibles

EXEMPLE DE BONNE DETECTION:
Si tu vois sur le plan une fenetre annotee "F1 36\"x54\" 2X" au coin (450, 1200):
  {{
    "detection_type": "count",
    "category": "window",
    "label": "Fenetre F1 36x54 2X",
    "points": [{{"x": 450, "y": 1200}}],
    "bounding_box": {{"x": 430, "y": 1180, "w": 40, "h": 40}},
    "detected_value": 2,
    "unit": "un",
    "confidence": 0.92,
    "color": "#F59E0B"
  }}

EXEMPLE DE MAUVAISE DETECTION (a EVITER):
- detected_value: 1 alors que "2X" visible = ERREUR
- points: tous au centre de l'image (1000, 1000) = ERREUR (Claude doit pointer chaque element distinctement)
- label: "Fenetre" sans dimension alors que "36x54" est visible = INCOMPLET

REGLES STRICTES:
1. Reponds UNIQUEMENT en JSON valide, AUCUN texte hors JSON.
2. Format exact: {{"detections": [...]}}
3. Si tu ne detectes RIEN dans une categorie, retourne un tableau vide.
4. NE JAMAIS inventer des elements non visibles. Mieux vaut peu de detections fiables que beaucoup de hallucinees.
5. Pour les surfaces: somme les zones meme categorie en UNE detection avec polygone du contour exterieur.{ctx}

Reponds maintenant avec ton JSON:"""


def _parse_detections_json(response_text: str) -> list[dict]:
    """Parse la reponse Claude en extrayant le JSON detections. Robuste aux wrappers markdown."""
    text = response_text.strip()
    # Strip code fences if present
    if text.startswith("```"):
        # Find first newline after opening fence
        first_nl = text.find("\n")
        if first_nl > 0:
            text = text[first_nl + 1:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # FIX-B2: avoid leaking exception details to client (Lecon #74)
        logger.error("Claude response JSON invalid: %s", text[:500])
        raise HTTPException(status_code=502, detail="Reponse IA mal formee. Reessayez.")
    detections = parsed.get("detections", [])
    if not isinstance(detections, list):
        raise HTTPException(status_code=502, detail="Format reponse IA invalide (detections n'est pas une liste)")
    return detections


# PHASE 3: helpers Mode INVENTAIRE RAPIDE (texte structure, sans coords).

def _build_quick_inventory_prompt(
    query: str,
    additional_context: Optional[str] = None,
    bom_products: Optional[list[dict]] = None,
    section_label: Optional[str] = None,
) -> str:
    """Construit le prompt pour mode INVENTAIRE RAPIDE (liste texte sans coords)."""
    bom_block = ""
    if bom_products:
        bom_text = _format_bom_for_prompt(bom_products, max_items=50)
        section_hdr = f" - SECTION {section_label}" if section_label else ""
        bom_block = f"""

CATALOGUE BOM TENANT{section_hdr}:
{bom_text}

Si un element correspond a un produit du catalogue, ajoute son `product_id` (number) dans la ligne d'inventaire."""

    ctx_block = f"\n\nCONTEXTE UTILISATEUR: {additional_context}" if additional_context else ""

    return f"""Tu es un expert en takeoff (metre) de plans de construction au Quebec/CCQ.
Analyse ce plan PDF et reponds a la question suivante en LISTE STRUCTUREE.

QUESTION: {query}{ctx_block}{bom_block}

Reponds UNIQUEMENT en JSON strict avec cette structure exacte:
{{
  "inventory": [
    {{
      "item": "Fenetre guillotine",
      "dimensions": "36x54",
      "quantity": 6,
      "unit": "un",
      "notes": "Toutes dans la zone agrandissement",
      "category": "Fenetres",
      "product_id": null
    }}
  ],
  "summary": "Resume en 1-2 phrases de ce que tu as trouve."
}}

REGLES STRICTES:
1. Lis ATTENTIVEMENT toutes les annotations du plan (dimensions, codes "F1", "2X", etc.)
2. Si la question precise une zone (agrandissement, existant, etage X), RESPECTE STRICTEMENT cette consigne
3. GROUPE par dimensions identiques: 6 fenetres 36x54 = 1 ligne avec quantity=6 (PAS 6 lignes)
4. ANNOTATION "2X" / "x2" / "(2)" SUR LE PLAN PDF = 2 unites identiques (multiplie quantity par 2 pour CE groupe)
5. "Verifier 2 fois" dans le CONTEXTE UTILISATEUR = INSTRUCTION DE RIGUEUR (relit ta reponse, NE MULTIPLIE PAS)
6. Pour les SURFACES (planchers, toitures, murs): unit="pi.ca", item="Plancher" + dimensions="14x11" + quantity=154 (= aire en pi2)
7. Pour les LONGUEURS (moulures, conduits): unit="pi.li" + quantity=longueur en pieds
8. Pour les COMPTAGES (fenetres, portes, prises): unit="un" + quantity=nombre
9. Si tu n'es pas sur d'une dimension, mets dimensions=null et explique dans notes
10. Si la zone demandee n'existe pas, retourne inventory=[] avec summary explicatif

SCAN SYSTEMATIQUE PAR ZONE (CRITIQUE pour eviter les oublis):
Avant de finaliser ta reponse, suis cette procedure:
1. Identifie TOUTES les pieces/zones du plan (chambre, salle de bain, salon, cuisine, garage, sous-sol, etc.)
2. Pour CHAQUE piece, scanne ses 4 murs un par un (nord, est, sud, ouest)
3. Liste mentalement les fenetres trouvees dans CHAQUE piece
4. Additionne le total
5. RECOMMENCE le scan une 2eme fois (verification)
6. Si les 2 totaux divergent, refais une 3eme passe
7. Inclus dans `notes` la piece de chaque groupe (ex: "Chambre des maitres + SDB", "Salon facade")

Exemple mental:
- Chambre maitres: 1 fenetre 36x54 (mur nord)
- SDB: 1 fenetre 36x54 (mur est)
- Salon: 2 fenetres 62x54 (mur sud, facade) + 1 a auvent (mur est)
- Cuisine: 1 fenetre (a verifier les dimensions)
- Total: 6... non, 7 avec la cuisine.
- Verification: oui, je vois bien 7 distinct fenetres.

RIGUEUR FINALE: Avant de retourner ton JSON, RELIS ta liste:
- Chaque ligne a-t-elle un item clair, dimensions (si visible), quantity coherente?
- As-tu respecte la zone demandee (agrandissement seulement = ignore zone existante)?
- Les "2X" annotes sur le plan sont-ils bien comptes (1 paire = quantity=2)?
- Y a-t-il des elements visibles que tu as oublies?

Reponds maintenant en JSON pur:"""


def _parse_quick_inventory_json(response_text: str) -> dict:
    """Parse robuste de la reponse Claude pour mode inventaire."""
    text = response_text.strip()
    if text.startswith("```"):
        first_nl = text.find("\n")
        if first_nl > 0:
            text = text[first_nl + 1:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        logger.error("Quick inventory JSON parse failed: %s", text[:500])
        raise HTTPException(status_code=502, detail="Reponse IA non parsable. Reessaie.")
    inventory = parsed.get("inventory", [])
    summary = parsed.get("summary", "")
    if not isinstance(inventory, list):
        raise HTTPException(status_code=502, detail="Format reponse IA invalide (inventory n'est pas une liste).")
    return {"inventory": inventory, "summary": summary}


# =============================================================================
# MULTI-PASS INVENTORY (precision mode): Pass 1 exhaustive scan + Pass 2 filter
# =============================================================================
# Ce mode separe la LECTURE du plan (Pass 1, vision) du FILTRAGE (Pass 2, texte).
# But: combattre les hallucinations contextuelles de Claude. Constate en prod:
# Claude inferait '(existante)' depuis les hachures du plan plutot que depuis
# l'annotation textuelle, classifiant 4 fenetres sur 6 comme "existantes" alors
# qu'AUCUN label n'incluait '(existante)'. Pass 1 force la lecture mot-pour-mot
# litterale; Pass 2 applique la logique de filtrage sans toucher a l'image.

def _build_pass1_exhaustive_prompt() -> str:
    """Prompt Pass 1: scan exhaustif litteral (vision, sans filtrage).

    Le but est OBSERVATION pure - Claude doit lire chaque label mot-pour-mot
    et flagger explicitement la presence/absence de '(existante)' dans le
    TEXTE du label, sans inferer depuis le style du dessin.
    """
    return """Tu es un expert en takeoff (metre) de plans de construction au Quebec/CCQ.

TACHE: SCAN EXHAUSTIF LITTERAL.
Liste TOUTES les annotations textuelles visibles sur ce plan PDF, MOT POUR MOT, sans interpretation, sans filtrage.

REGLES STRICTES POUR LA LECTURE:

1. LIS CHAQUE LABEL LITTERALEMENT.
   - Si tu vois "Fenetre a guill. 36"x60"", ecris EXACTEMENT "Fenetre a guill. 36\\"x60\\""
   - Si tu vois "Fenetre a guill. (existante) 36"x60"", inclus "(existante)" comme dans le label
   - Ne PARAPHRASE pas, ne CONDENSE pas

2. LE FLAG "has_existante_annotation" :
   - true SEULEMENT si le mot "(existante)", "(existant)", "(existing)", "(exist.)" apparait
     EXPLICITEMENT dans le TEXTE du label
   - false dans TOUS les autres cas

3. NE PAS INFERER "existante" depuis le DESSIN:
   - Hachures, lignes pointillees, patterns de mur ne sont PAS des indicateurs textuels
   - Une zone hachuree ne rend pas une fenetre "existante" - seule la mention
     EXPLICITE dans le label le fait
   - Si tu hesites, has_existante_annotation = FALSE (par defaut)

4. SCAN SYSTEMATIQUE PAR ZONE:
   - Mur nord (haut), mur sud (bas), mur est (droite), mur ouest (gauche)
   - Murs interieurs, cloisons, portes, fenetres, codes
   - Pour chaque label trouve, indique sa POSITION sur le plan

5. INCLUS TOUS LES TYPES D'ELEMENTS VISIBLES (pas juste fenetres):
   - Fenetres avec dimensions
   - Portes avec dimensions
   - Pieces (BUREAU, GARAGE, SDB, etc.) avec dimensions
   - Annotations techniques (FOSSE DE RETENU, FER D'ANGLE, etc.)
   - Codes (D-3, M1, V, M/F, C-1, etc.)

Reponds UNIQUEMENT en JSON strict:
{
  "all_labels": [
    {
      "text": "Fenetre a guill. 36\\"x60\\"",
      "type": "fenetre",
      "position": "haut, mur nord du bureau",
      "has_existante_annotation": false
    },
    {
      "text": "Fenetre a guill. (existante)",
      "type": "fenetre",
      "position": "droite, mur est de la maison existante",
      "has_existante_annotation": true
    }
  ],
  "page_zones": ["bureau", "garage", "salle-de-bain", "vestibule"],
  "summary": "Description en 2-3 phrases de la disposition du plan."
}

INTERDIT:
- Inventer ou ajouter "(existante)" si non present dans le label
- Filtrer/exclure des elements selon une zone
- Interpreter (juste lire et rapporter)
- Resumer plusieurs labels en un seul (chaque occurrence = 1 entry)

Lance le scan systematique maintenant. Reponds en JSON pur:"""


def _parse_pass1_json(response_text: str) -> dict:
    """Parse robuste de la reponse Pass 1 (scan exhaustif)."""
    text = response_text.strip()
    if text.startswith("```"):
        first_nl = text.find("\n")
        if first_nl > 0:
            text = text[first_nl + 1:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        logger.error("Pass 1 JSON parse failed: %s", text[:500])
        raise HTTPException(status_code=502, detail="Reponse IA Pass 1 non parsable. Reessaie.")
    all_labels = parsed.get("all_labels", [])
    if not isinstance(all_labels, list):
        raise HTTPException(status_code=502, detail="Format Pass 1 invalide (all_labels manquant).")
    return {
        "all_labels": all_labels,
        "page_zones": parsed.get("page_zones", []),
        "summary": parsed.get("summary", ""),
    }


def _build_pass2_filter_prompt(
    pass1_data: dict,
    query: str,
    additional_context: Optional[str] = None,
    bom_products: Optional[list[dict]] = None,
    section_label: Optional[str] = None,
) -> str:
    """Prompt Pass 2: filtre l'inventaire Pass 1 selon la requete utilisateur.

    Pas besoin de vision - on travaille sur le JSON extrait par Pass 1.
    """
    bom_block = ""
    if bom_products:
        bom_text = _format_bom_for_prompt(bom_products, max_items=50)
        section_hdr = f" - SECTION {section_label}" if section_label else ""
        bom_block = f"""

CATALOGUE BOM TENANT{section_hdr}:
{bom_text}

Si un element correspond a un produit du catalogue, ajoute son `product_id` (number) dans la ligne d'inventaire."""

    ctx_block = f"\n\nCONTEXTE UTILISATEUR: {additional_context}" if additional_context else ""
    pass1_json = json.dumps(pass1_data, ensure_ascii=False, indent=2)

    return f"""Tu es un expert en takeoff. Un scan exhaustif du plan a deja ete fait.
Voici TOUS les labels detectes sur le plan, lus mot-pour-mot:

LABELS DU PLAN (Pass 1):
{pass1_json}

QUESTION DE L'UTILISATEUR: {query}{ctx_block}{bom_block}

TACHE: Filtre cette liste selon la question et produis un inventaire structure.

REGLES DE FILTRAGE STRICTES:

1. UN ELEMENT EST "EXISTANT" SEULEMENT SI has_existante_annotation = true.
   - Ne PAS inferer existant depuis position ou type
   - Le flag du Pass 1 fait FOI

2. SI LA QUESTION DIT "agrandissement seulement" / "ignorer existant" / "nouveau seulement":
   - INCLURE: tous les elements avec has_existante_annotation = false
   - EXCLURE: tous les elements avec has_existante_annotation = true

3. SI LA QUESTION DIT "existant seulement" / "tel quel":
   - INCLURE: tous les elements avec has_existante_annotation = true
   - EXCLURE: tous les elements avec has_existante_annotation = false

4. SI LA QUESTION NE PRECISE PAS DE ZONE: inclus TOUT.

5. FILTRE PAR TYPE selon la question:
   - "fenetres" -> garde type="fenetre"
   - "portes" -> garde type="porte"
   - "tout" / pas de precision de type -> garde tout

6. GROUPE par dimensions identiques:
   - 3 fenetres "36\\"x60\\"" identiques -> 1 ligne avec quantity=3 (PAS 3 lignes)
   - dimensions DIFFERENTES = lignes separees

7. UNITES:
   - Fenetres/portes/comptages: unit="un", quantity=nombre
   - Surfaces: unit="pi.ca", quantity=aire
   - Longueurs: unit="pi.li", quantity=longueur

8. NOTES: indique la/les position(s) (ex: "mur nord bureau + mur ouest garage")

Reponds UNIQUEMENT en JSON strict:
{{
  "inventory": [
    {{
      "item": "Fenetre a guillotine",
      "dimensions": "36x60",
      "quantity": 3,
      "unit": "un",
      "notes": "Mur nord bureau, mur ouest bureau, mur ouest garage",
      "category": "Fenetres",
      "product_id": null
    }}
  ],
  "summary": "Resume en 1-2 phrases du resultat filtre."
}}

VERIFICATION FINALE avant de repondre:
- As-tu inclus TOUS les elements correspondant a la requete?
- As-tu correctement applique le flag has_existante_annotation?
- Les quantites sont-elles le COMPTE des occurrences (pas 1 si multiples)?

Reponds maintenant en JSON pur:"""


def _call_claude_vision_with_thinking(
    img_b64: str,
    prompt: str,
    thinking_budget: int = 10000,  # DEPRECATED on Opus 4.7 - ignored, kept for backward compat
    max_response_tokens: int = 100000,
    effort: str = "high",  # adaptive thinking effort: low / medium / high (default) / xhigh / max
):
    """Call Claude Vision Opus 4.7 with Adaptive Thinking.

    Sur Claude Opus 4.7, manual thinking (`{"type": "enabled", "budget_tokens": N}`)
    est REJETE par l'API avec 400 invalid_request_error. La syntaxe officielle est
    `thinking={"type": "adaptive"}` + `output_config={"effort": "..."}`.
    Cf. https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking

    EFFORT par defaut "high" = comportement equivalent a l'ancien `enabled` +
    `budget_tokens=10000`: d'apres la doc Anthropic "Claude almost always thinks.
    Provides deep reasoning on complex tasks." Suffisant pour analyses Vision
    standard (takeoff plans architecturaux nets).

    Pour analyses de plans manuscrits / complexes ou si on observe une regression
    de precision (ex: 2 fenetres detectees au lieu de 7), passer effort="xhigh"
    (raisonnement plus profond, consomme plus de tokens).

    Le parametre `thinking_budget` est conserve dans la signature pour ne pas
    casser les callers existants (metre_pdf.py:4798), mais n'a plus aucun effet
    sur Opus 4.7. Migrer progressivement vers le parametre `effort`.

    Thinking tokens sont factures comme output tokens (deja inclus dans
    usage.output_tokens). Returns the full message object.

    STREAMING REQUIRED: cf. commit 4a952f3.
    """
    client = _anthropic_client_for_files()
    # max_tokens fixed at 32000 (decision Sylvain 2026-05-17): uniformite
    # entre tous les call sites. max_response_tokens reste accepte dans la
    # signature pour compatibilite caller mais est ignore ici (cap hard 32k
    # couvre thinking + response COMBINES sur Opus 4.7).
    max_tokens = 32000
    with client.messages.stream(
        model="claude-opus-4-7",
        max_tokens=max_tokens,
        timeout=600.0,
        thinking={"type": "adaptive"},
        extra_body={"output_config": {"effort": effort}},
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": img_b64}},
                {"type": "text", "text": prompt},
            ],
        }],
    ) as stream:
        return stream.get_final_message()


def _extract_text_from_thinking_response(message) -> str:
    """Extract only the 'text' content blocks from a Claude response, ignoring 'thinking' blocks.

    With Extended Thinking enabled, content can include reasoning blocks
    that aren't valid JSON. We only want the final text answer for parsing.
    """
    text = ""
    for block in message.content:
        block_type = getattr(block, 'type', None)
        if block_type == 'text' and hasattr(block, 'text'):
            text += block.text
        # Ignore type='thinking' blocks (internal reasoning, not for parsing)
    return text


def _count_thinking_tokens(message) -> int:
    """Estimate thinking tokens by inspecting content blocks.

    Le SDK Anthropic n'expose PAS `usage.thinking_tokens` comme champ separe -
    les thinking tokens sont bundles dans `output_tokens`. La seule facon
    fiable de detecter si Extended Thinking a vraiment tourne est de compter
    les caracteres dans les blocks de type 'thinking' du content.

    Returns 0 si aucun block thinking present (= thinking n'a pas tourne,
    ex: mode adaptive a choisi de skip).

    Note: l'estimation 1 token = 4 chars est imprecise (Claude tokenize plus
    finement) mais permet de distinguer "thinking absent" de "thinking present"
    avec une approximation de l'ordre de grandeur.
    """
    if not message or not getattr(message, 'content', None):
        return 0
    total_chars = 0
    for block in message.content:
        if getattr(block, 'type', None) == 'thinking':
            text = getattr(block, 'thinking', '') or ''
            total_chars += len(text)
    return total_chars // 4 if total_chars > 0 else 0


# --- Products ---

def _db_create_product(schema: str, data: dict, user_id: int) -> dict:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        bom_inputs_raw = data.get('bom_inputs')
        bom_inputs_json = json.dumps(bom_inputs_raw) if bom_inputs_raw is not None else None
        cursor.execute(
            """INSERT INTO metre_products
               (name, category, dimensions, price, price_unit, color, waste_pct,
                is_composite, display_mode, price_override, description, bom_inputs,
                nb_hommes, nb_hrs_par_jour, nb_jours, numero_section, labor_trade_id,
                created_by)
               VALUES (%(name)s, %(category)s, %(dimensions)s, %(price)s,
                       %(price_unit)s, %(color)s, %(waste_pct)s,
                       %(is_composite)s, %(display_mode)s, %(price_override)s,
                       %(description)s, %(bom_inputs)s,
                       %(nb_hommes)s, %(nb_hrs_par_jour)s, %(nb_jours)s,
                       %(numero_section)s, %(labor_trade_id)s,
                       %(created_by)s)
               RETURNING *""",
            {
                'name': data.get('name'),
                'category': data.get('category', ''),
                'dimensions': data.get('dimensions', ''),
                'price': data.get('price', 0),
                'price_unit': data.get('price_unit', 'un'),
                'color': data.get('color', '#3b82f6'),
                'waste_pct': data.get('waste_pct', 0),
                'is_composite': data.get('is_composite', False),
                'display_mode': data.get('display_mode', 'detailed'),
                'price_override': data.get('price_override'),
                'description': data.get('description'),
                'bom_inputs': bom_inputs_json,
                'nb_hommes': data.get('nb_hommes'),
                'nb_hrs_par_jour': data.get('nb_hrs_par_jour'),
                'nb_jours': data.get('nb_jours'),
                'numero_section': data.get('numero_section'),
                'labor_trade_id': data.get('labor_trade_id'),
                'created_by': user_id,
            },
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="INSERT metre_products n'a pas retourne d'id")
        result = dict(row)
        conn.commit()
        cursor.close()
        return result
    except psycopg2.errors.UniqueViolation:
        # Concurrent create with same (name, category) -- friendlier 409 than a 500.
        # Triggered by uq_metre_products_name_category constraint when two requests
        # race or when an idempotent client retries after a partial failure.
        conn.rollback()
        raise HTTPException(
            status_code=409,
            detail="Un produit avec ce nom et cette categorie existe deja.",
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# --- Product components (BOM) ---

def _db_list_components(schema: str, parent_product_id: int) -> list[dict]:
    """List all components (child products) attached to a parent product, with child metadata."""
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            """SELECT c.id, c.parent_product_id, c.child_product_id,
                      c.quantity_per_unit, c.formula, c.notes, c.sort_order,
                      p.name AS child_name, p.category AS child_category,
                      p.price AS child_price, p.price_unit AS child_price_unit,
                      p.waste_pct AS child_waste_pct, p.color AS child_color
               FROM metre_product_components c
               JOIN metre_products p ON p.id = c.child_product_id
               WHERE c.parent_product_id = %s
               ORDER BY c.sort_order, c.id""",
            (parent_product_id,),
        )
        return [dict(r) for r in cursor.fetchall()]
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_create_component(schema: str, parent_id: int, data: dict) -> dict:
    """Attach a child product to a parent composite product."""
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        # Guard: parent must be composite and not self-reference
        if parent_id == data['child_product_id']:
            raise HTTPException(status_code=400, detail="Un produit ne peut pas se contenir lui-meme")
        cursor.execute("SELECT is_composite FROM metre_products WHERE id = %s", (parent_id,))
        parent_row = cursor.fetchone()
        if not parent_row:
            raise HTTPException(status_code=404, detail="Produit parent introuvable")
        if not parent_row.get('is_composite'):
            raise HTTPException(
                status_code=400,
                detail="Le produit parent n'est pas marque comme composite"
            )
        cursor.execute("SELECT is_composite FROM metre_products WHERE id = %s", (data['child_product_id'],))
        child_row = cursor.fetchone()
        if not child_row:
            raise HTTPException(status_code=404, detail="Produit enfant introuvable")
        # 1-level nesting only: composite cannot reference another composite
        if child_row.get('is_composite'):
            raise HTTPException(status_code=400, detail="Imbrication de composites non supportee (1 niveau max)")

        # Validate formula BEFORE the INSERT so a bad regex match returns 400, not 500.
        try:
            validated_formula = _validate_formula(data.get('formula'))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        try:
            cursor.execute(
                """INSERT INTO metre_product_components
                   (parent_product_id, child_product_id, quantity_per_unit, formula, notes, sort_order)
                   VALUES (%(parent_id)s, %(child_id)s, %(qty)s, %(formula)s, %(notes)s, %(sort)s)
                   ON CONFLICT (parent_product_id, child_product_id) DO UPDATE SET
                       quantity_per_unit = EXCLUDED.quantity_per_unit,
                       formula = EXCLUDED.formula,
                       notes = EXCLUDED.notes,
                       sort_order = EXCLUDED.sort_order
                   RETURNING *""",
                {
                    'parent_id': parent_id,
                    'child_id': data['child_product_id'],
                    'qty': data.get('quantity_per_unit', 1),
                    'formula': validated_formula,
                    'notes': data.get('notes'),
                    'sort': data.get('sort_order', 0),
                },
            )
        except psycopg2.errors.ForeignKeyViolation:
            # Concurrent delete of parent or child product between our SELECT and INSERT
            conn.rollback()
            raise HTTPException(
                status_code=400,
                detail="Produit parent ou enfant supprime pendant l'operation"
            )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="INSERT metre_product_components a echoue")
        conn.commit()
        cursor.close()
        return dict(row)
    except HTTPException:
        # Order matters: HTTPException-first AVANT Exception (lecon #5).
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_update_component(schema: str, parent_id: int, component_id: int, data: dict) -> Optional[dict]:
    """Update a component. Scoped to parent_id for security (prevents cross-parent mutation)."""
    fields = _validate_fields(data, ALLOWED_COMPONENT_FIELDS, 'component')
    if 'formula' in fields:
        # Validate formula syntax / safe charset before persisting.
        try:
            fields['formula'] = _validate_formula(fields['formula'])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    if not fields:
        # No-op: return the current state (still scoped to parent)
        conn = _get_conn_for_tenant(schema)
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM metre_product_components WHERE id = %s AND parent_product_id = %s",
                (component_id, parent_id),
            )
            row = cursor.fetchone()
            cursor.close()
            return dict(row) if row else None
        except Exception:
            conn.rollback()
            raise
        finally:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            conn.close()
    set_clauses = ", ".join(f"{k} = %({k})s" for k in fields)
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE metre_product_components SET {set_clauses} "
            f"WHERE id = %(id)s AND parent_product_id = %(parent_id)s RETURNING *",
            {**fields, 'id': component_id, 'parent_id': parent_id},
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_delete_component(schema: str, parent_id: int, component_id: int) -> bool:
    """Delete a component, scoped to parent_id for security."""
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM metre_product_components WHERE id = %s AND parent_product_id = %s",
            (component_id, parent_id),
        )
        deleted = cursor.rowcount > 0
        conn.commit()
        cursor.close()
        return deleted
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_list_products(schema: str, category: Optional[str] = None) -> list[dict]:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        if category:
            cursor.execute(
                "SELECT * FROM metre_products WHERE category = %s ORDER BY name",
                (category,)
            )
        else:
            cursor.execute("SELECT * FROM metre_products ORDER BY category, name")
        result = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


# PHASE 2: BOM-aware helpers

def _db_list_products_by_section(schema: str, numero_section: str) -> list[dict]:
    """List metre_products filtered by numero_section. PHASE 2 BOM-aware.

    AMELIORATION 1 (fallback category): si aucun produit n'a `numero_section`
    rempli, etend le match a `category` pour les tenants qui n'utilisent pas
    encore les sections normalisees. Pattern:
        WHERE numero_section = %s OR (numero_section IS NULL AND category = %s)
    Si aucun match -> liste vide (Claude generera detections sans BOM filter).
    """
    conn = None
    try:
        conn = _get_conn_for_tenant(schema)
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, name, category, dimensions, price, price_unit, color,
                   numero_section, description
            FROM metre_products
            WHERE numero_section = %s
               OR ((numero_section IS NULL OR numero_section = '') AND category = %s)
            ORDER BY name
            """,
            (numero_section, numero_section),
        )
        result = [dict(r) for r in cursor.fetchall()]
        cursor.close()
        return result
    finally:
        if conn is not None:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass


def _db_list_distinct_sections(schema: str) -> list[str]:
    """List distinct non-null numero_section values from metre_products. PHASE 2.

    AMELIORATION 1 (fallback category): si la query principale retourne []
    (tenant n'a pas encore rempli `numero_section`), bascule sur les valeurs
    distinctes de `category` pour permettre le mode BOM avec les categories
    existantes. Cas d'usage: Mario a 856 produits sans numero_section mais
    35 categories - on lui permet de choisir une category comme "section".
    """
    conn = None
    try:
        conn = _get_conn_for_tenant(schema)
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT DISTINCT numero_section
            FROM metre_products
            WHERE numero_section IS NOT NULL AND numero_section <> ''
            ORDER BY numero_section
            """
        )
        rows = cursor.fetchall()
        # RealDictCursor returns dict-like rows -> extract the column value.
        out: list[str] = []
        for r in rows:
            if isinstance(r, dict):
                val = r.get('numero_section')
            else:
                # Fallback for tuple-style rows
                try:
                    val = r[0]
                except Exception:
                    val = None
            if val:
                out.append(str(val))
        # AMELIORATION 1: fallback to category if no numero_section found
        if not out:
            cursor.execute(
                """
                SELECT DISTINCT category
                FROM metre_products
                WHERE category IS NOT NULL AND category <> ''
                ORDER BY category
                """
            )
            rows2 = cursor.fetchall()
            for r in rows2:
                if isinstance(r, dict):
                    val = r.get('category')
                else:
                    try:
                        val = r[0]
                    except Exception:
                        val = None
                if val:
                    out.append(str(val))
        cursor.close()
        return out
    finally:
        if conn is not None:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass


def _section_default_color(section_numero: str) -> str:
    """Deterministic color per section number for layer auto-creation. PHASE 2."""
    palette = {
        '01': '#3B82F6',  # blue - Fondation
        '02': '#8B5CF6',  # violet - Charpente
        '03': '#EC4899',  # pink - Toiture
        '04': '#10B981',  # emerald - Revetement ext
        '05': '#F59E0B',  # amber - Isolation
        '06': '#06B6D4',  # cyan - Plomberie
        '07': '#FBBF24',  # yellow - Electricite
        '08': '#A78BFA',  # purple - CVAC
        '09': '#F97316',  # orange - Cloisons
        '10': '#0EA5E9',  # sky - Revetement int
        '11': '#84CC16',  # lime - Finitions
        '12': '#6366F1',  # indigo - Specialites
    }
    return palette.get(section_numero, '#9CA3AF')


def _db_get_or_create_section_layer(
    schema: str, document_id: int, section_numero: str
) -> dict:
    """Get or create a layer dedicated to a section. PHASE 2.

    Idempotent thanks to UNIQUE INDEX uq_metre_layers_doc_name.
    """
    layer_name = f"Section {section_numero}"
    layers = _db_list_layers(schema, document_id)
    for layer in layers:
        if layer.get('name') == layer_name:
            return layer
    # Auto-create
    try:
        return _db_create_layer(schema, document_id, {
            'name': layer_name,
            'color': _section_default_color(section_numero),
            'visible': True,
            'locked': False,
        })
    except Exception:
        # Race lost: re-fetch
        refetch = _db_list_layers(schema, document_id)
        for layer in refetch:
            if layer.get('name') == layer_name:
                return layer
        # Last resort: create with timestamp suffix
        from datetime import datetime as _dt
        suffix = _dt.utcnow().strftime('%H%M%S')
        return _db_create_layer(schema, document_id, {
            'name': f"{layer_name} ({suffix})",
            'color': _section_default_color(section_numero),
            'visible': True,
            'locked': False,
        })


def _db_get_product(schema: str, product_id: int) -> Optional[dict]:
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM metre_products WHERE id = %s", (product_id,))
        row = cursor.fetchone()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_update_product(schema: str, product_id: int, data: dict) -> Optional[dict]:
    fields = _validate_fields(data, ALLOWED_PRODUCT_FIELDS_UPDATE, 'produit')
    if not fields:
        return _db_get_product(schema, product_id)
    # Serialize JSONB columns (psycopg2 doesn't auto-adapt list[dict] to JSONB).
    if 'bom_inputs' in fields and fields['bom_inputs'] is not None:
        fields['bom_inputs'] = json.dumps(fields['bom_inputs'])
    set_clauses = ", ".join(f"{k} = %({k})s" for k in fields)
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE metre_products SET {set_clauses}, updated_at = NOW() "
            f"WHERE id = %(id)s RETURNING *",
            {**fields, 'id': product_id}
        )
        row = cursor.fetchone()
        conn.commit()
        cursor.close()
        return dict(row) if row else None
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_delete_product(schema: str, product_id: int) -> bool:
    """Delete a product. Raises HTTPException 409 if it's referenced as a
    child in any composite (FK RESTRICT)."""
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM metre_products WHERE id = %s", (product_id,))
        deleted = cursor.rowcount > 0
        conn.commit()
        cursor.close()
        return deleted
    except psycopg2.errors.ForeignKeyViolation:
        conn.rollback()
        raise HTTPException(
            status_code=409,
            detail="Ce produit est utilise comme composant d'un assemblage et ne peut pas etre supprime. "
                   "Retirez-le d'abord des produits composites qui le referencent."
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


def _db_bulk_upsert_products(schema: str, products: list[dict], user_id: int) -> list[dict]:
    """Bulk insert metre_products via psycopg2 execute_values (1 round-trip vs N).

    Avec ON CONFLICT (name, category) DO NOTHING + RETURNING, seuls les rows
    nouvellement inseres sont retournes -- les doublons sont silencieusement
    skip (semantique identique a la version pre-execute_values).
    """
    if not products:
        return []

    # Validation bom_inputs: doit etre list ou dict (JSON-serializable structure),
    # pas une string pre-encodee. Sinon json.dumps() re-encoderait en string literal
    # JSONB ('"foo"' au lieu d'un objet) ce qui casserait extractVariables cote frontend.
    def _normalize_bom_inputs(raw: Any) -> Optional[str]:
        if raw is None:
            return None
        if isinstance(raw, (list, dict)):
            return json.dumps(raw)
        if isinstance(raw, str):
            # Si caller a deja serialise, parse-back puis re-dump pour valider.
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, (list, dict)):
                    return json.dumps(parsed)
            except (json.JSONDecodeError, ValueError):
                pass
            logger.warning(f"[Metre] bom_inputs string non-JSON ignore: {raw[:60]}")
            return None
        # Type inattendu (number, bool, etc.) -- skip plutot que stocker n'importe quoi.
        logger.warning(f"[Metre] bom_inputs type inattendu {type(raw).__name__} ignore")
        return None

    # Lecon #100: conn=None AVANT try, guards if conn dans except/finally
    conn = None
    try:
        conn = _get_conn_for_tenant(schema)
        cursor = conn.cursor()
        rows_to_insert = [
            (
                p.get('name'),
                p.get('category', ''),
                p.get('dimensions', ''),
                p.get('price', 0),
                p.get('price_unit', 'un'),
                p.get('color', '#3b82f6'),
                p.get('waste_pct', 0),
                p.get('is_composite', False),
                p.get('display_mode', 'detailed'),
                p.get('price_override'),
                p.get('description'),
                _normalize_bom_inputs(p.get('bom_inputs')),
                p.get('nb_hommes'),
                p.get('nb_hrs_par_jour'),
                p.get('nb_jours'),
                p.get('numero_section'),
                p.get('labor_trade_id'),
                user_id,
            )
            for p in products
        ]
        results_raw = psycopg2.extras.execute_values(
            cursor,
            """INSERT INTO metre_products
               (name, category, dimensions, price, price_unit, color, waste_pct,
                is_composite, display_mode, price_override, description, bom_inputs,
                nb_hommes, nb_hrs_par_jour, nb_jours, numero_section, labor_trade_id,
                created_by)
               VALUES %s
               ON CONFLICT (name, category) DO NOTHING
               RETURNING *""",
            rows_to_insert,
            page_size=100,
            fetch=True,
        )
        # RealDictCursor (configure dans db.get_conn) retourne RealDictRow,
        # convertis en dict pour FastAPI JSON serialization.
        results = [dict(r) for r in results_raw]
        conn.commit()
        cursor.close()
        return results
    except Exception:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        raise
    finally:
        if conn is not None:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass


# =============================================================================
# HELPERS
# =============================================================================

def _safe_file_path(base_dir: Path, *parts: str) -> Path:
    """Resolve a file path and ensure it stays within base_dir (path traversal prevention)."""
    from urllib.parse import unquote
    decoded_parts = []
    for p in parts:
        decoded = unquote(unquote(p))
        decoded_parts.append(decoded)
    try:
        resolved = (base_dir / Path(*decoded_parts)).resolve()
    except (ValueError, OSError):
        raise HTTPException(status_code=400, detail="Chemin de fichier invalide")
    if not resolved.is_relative_to(base_dir.resolve()):
        raise HTTPException(status_code=400, detail="Chemin de fichier invalide")
    return resolved


# =============================================================================
# LRU CACHE FOR PDF PAGE RENDERING
# =============================================================================

class _PageRenderCache:
    """LRU cache for rendered PDF page PNGs."""

    def __init__(self, max_size: int = PDF_RENDER_CACHE_SIZE, ttl: int = PDF_RENDER_CACHE_TTL):
        self._cache: OrderedDict[str, tuple[bytes, float]] = OrderedDict()
        self._max_size = max_size
        self._ttl = ttl

    def _make_key(self, file_path: str, page_number: int, zoom: float) -> str:
        return f"{file_path}:{page_number}:{zoom:.2f}"

    def get(self, file_path: str, page_number: int, zoom: float) -> Optional[bytes]:
        key = self._make_key(file_path, page_number, zoom)
        if key in self._cache:
            data, ts = self._cache[key]
            if time.time() - ts < self._ttl:
                self._cache.move_to_end(key)
                return data
            else:
                del self._cache[key]
        return None

    def put(self, file_path: str, page_number: int, zoom: float, data: bytes) -> None:
        key = self._make_key(file_path, page_number, zoom)
        self._cache[key] = (data, time.time())
        self._cache.move_to_end(key)
        while len(self._cache) > self._max_size:
            self._cache.popitem(last=False)

    def invalidate(self, file_path: str) -> None:
        keys_to_remove = [k for k in self._cache if k.startswith(file_path + ":")]
        for k in keys_to_remove:
            del self._cache[k]


_page_cache = _PageRenderCache()


# =============================================================================
# API ENDPOINTS: PROJECTS
# =============================================================================

@router.post("/projects", response_model=ProjectResponse)
async def create_project(
    data: ProjectCreate,
    user: ErpUser = Depends(_require_tenant),
):
    """Cree un nouveau projet de metrage."""
    _ensure_tables(user.schema)
    result = _db_create_project(user.schema, data.model_dump(), user.user_id)
    return result


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(user: ErpUser = Depends(_require_tenant)):
    """Liste tous les projets de metrage."""
    _ensure_tables(user.schema)
    return _db_list_projects(user.schema)


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Recupere un projet par son ID."""
    _ensure_tables(user.schema)
    result = _db_get_project(user.schema, project_id)
    if not result:
        raise HTTPException(status_code=404, detail="Projet non trouvé")
    return result


@router.put("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int,
    data: ProjectUpdate,
    user: ErpUser = Depends(_require_tenant),
):
    """Met a jour un projet existant."""
    _ensure_tables(user.schema)
    result = _db_update_project(
        user.schema, project_id, data.model_dump(exclude_unset=True)
    )
    if not result:
        raise HTTPException(status_code=404, detail="Projet non trouvé")
    return result


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Supprime un projet et toutes ses donnees."""
    _ensure_tables(user.schema)
    # Invalidate the LRU page cache for every document in this project AND
    # best-effort unlink any legacy disk files. The PDF binary itself lives
    # in BD now (`metre_documents.file_data` BYTEA), so the DB cascade
    # `ON DELETE CASCADE` from `metre_projects → metre_documents` removes
    # the binary atomically with the project. The disk unlink is purely a
    # cleanup of legacy files for tenants that uploaded before BYTEA storage.
    try:
        docs = _db_list_documents(user.schema, project_id)
        for d in docs:
            try:
                _page_cache.invalidate(f"doc:{user.schema}:{d['id']}")
                fp = _safe_file_path(UPLOAD_DIR, user.schema, d['filename'])
                fp.unlink(missing_ok=True)
            except Exception as exc:
                logger.warning("delete_project: cleanup failed for %s: %s", d.get('filename'), exc)
    except Exception as exc:
        # If listing fails, fall through to the DB delete — the orphan files
        # will need a separate cleanup pass. Logged for diagnostics.
        logger.warning("delete_project: list_documents failed for project %s: %s", project_id, exc)
    if not _db_delete_project(user.schema, project_id):
        raise HTTPException(status_code=404, detail="Projet non trouvé")
    return {"status": "deleted"}


@router.get("/metres-library", response_model=list[MetreLibraryEntry])
async def list_metres_library(user: ErpUser = Depends(_require_tenant)):
    """Liste agrégée des métrés sauvegardés (pour la modale de bibliothèque).

    Renvoie pour chaque projet : nom, description, document principal, nombre
    de mesures et de calques, dernière modification, devis lié. Une seule
    requête optimisée — pas de N+1 côté frontend.
    """
    _ensure_tables(user.schema)
    return _db_list_metres_library(user.schema)


# =============================================================================
# API ENDPOINTS: DOCUMENTS (PDF Upload & Rendering)
# =============================================================================

@router.post(
    "/projects/{project_id}/documents/upload",
    response_model=PDFDocumentResponse,
)
async def upload_document(
    project_id: int,
    file: UploadFile = File(...),
    user: ErpUser = Depends(_require_tenant),
):
    """Upload un fichier PDF et extrait les metadonnees (nombre de pages)."""
    _ensure_tables(user.schema)

    # Validate project exists
    project = _db_get_project(user.schema, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet non trouvé")

    # Validate file type
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(
            status_code=400,
            detail="Seuls les fichiers PDF sont acceptes"
        )

    # Read file content
    content = await file.read()
    file_size = len(content)

    if file_size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Fichier trop volumineux. Maximum: {MAX_FILE_SIZE_MB} MB"
        )

    if file_size == 0:
        raise HTTPException(status_code=400, detail="Fichier vide")

    # Validate PDF magic number
    if not content[:5].startswith(b'%PDF-'):
        logger.warning(f"[Security] Rejected upload: invalid PDF magic number from user {user.user_id}")
        raise HTTPException(
            status_code=400,
            detail="Fichier PDF invalide (signature incorrecte)"
        )

    # Extract page count with PyMuPDF
    if not _HAS_FITZ:
        raise HTTPException(
            status_code=500,
            detail="PyMuPDF (fitz) non installe sur le serveur"
        )
    try:
        pdf_doc = fitz.open(stream=content, filetype="pdf")
        page_count = len(pdf_doc)
        pdf_doc.close()
    except Exception:
        logger.exception("Erreur lecture PDF")
        raise HTTPException(
            status_code=400,
            detail="Fichier PDF invalide ou corrompu"
        )

    # Generate a stable unique name (kept as identity column even though the
    # PDF binary now lives in BD as BYTEA — the name is still used as the
    # fallback disk path for any legacy document uploaded before the BYTEA
    # migration. The page-render LRU cache keys on `doc:{schema}:{id}`, not
    # on the filename, so it survives across redeploys / filename changes.
    unique_name = f"{user.schema}_{project_id}_{uuid.uuid4().hex}.pdf"

    # Save metadata + binary to database. Storing the file in PostgreSQL
    # (not on the local filesystem) ensures it survives Render redeploys —
    # the ephemeral disk would otherwise wipe every uploaded PDF on each
    # deployment, leaving métré projects pointing at missing files (the
    # "Maison Papineau" bug class).
    doc_data = {
        'filename': unique_name,
        'original_filename': file.filename,
        'page_count': page_count,
        'file_size_bytes': file_size,
        # Force application/pdf — the magic-byte validation above (`%PDF-`)
        # already guarantees the binary IS a PDF. Trusting the client-supplied
        # Content-Type would let an attacker store a polyglot PDF labelled as
        # `text/html`, which the browser would then render inline as HTML on
        # download → XSS in the ERP origin. Always pin the response media
        # type to the validated content type.
        'mime_type': 'application/pdf',
    }

    try:
        result = _db_create_document(user.schema, project_id, doc_data, file_bytes=content)
    except Exception:
        logger.exception("Erreur DB creation document")
        raise HTTPException(status_code=500, detail="Erreur base de donnees")

    return result


@router.get("/projects/{project_id}/documents", response_model=list[PDFDocumentResponse])
async def list_documents(
    project_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Liste les documents d'un projet."""
    _ensure_tables(user.schema)
    project = _db_get_project(user.schema, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Projet non trouvé")
    return _db_list_documents(user.schema, project_id)


@router.get("/documents/{document_id}", response_model=PDFDocumentResponse)
async def get_document(
    document_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Recupere les informations d'un document PDF."""
    _ensure_tables(user.schema)
    result = _db_get_document(user.schema, document_id)
    if not result:
        raise HTTPException(status_code=404, detail="Document non trouvé")
    return result


@router.get("/documents/{document_id}/file")
async def download_document_file(
    document_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Sert le PDF original pour ré-ouverture côté frontend (pdfjs).

    Utilisé par le composant Métré quand l'utilisateur ouvre un métré
    sauvegardé : le frontend fetch ce binaire et le passe à pdfjs comme
    ArrayBuffer.

    Source primaire : la BD (BYTEA stocké dans `metre_documents.file_data`)
    pour survivre aux redéploiements Render (filesystem éphémère). Fallback
    legacy : si `file_data IS NULL` (anciens documents pré-migration), on
    sert le fichier disque s'il existe encore — le métré est marqué
    "introuvable" si ni la BD ni le disque ne l'ont.
    """
    _ensure_tables(user.schema)

    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouvé")

    # Source primaire : BD. Source secondaire : disque (legacy uniquement).
    file_data: bytes | None = None
    file_size: int = 0
    if doc_info.get('has_file_data'):
        file_data = _db_get_document_data(user.schema, document_id)
        if file_data is not None:
            file_size = len(file_data)

    file_path = None
    if file_data is None:
        # Legacy fallback : tenter le disque pour les documents antérieurs
        # à la migration BYTEA. Sera 404 si le disque a été purgé par un
        # redéploiement Render — l'utilisateur doit alors re-uploader.
        file_path = _safe_file_path(UPLOAD_DIR, user.schema, doc_info['filename'])
        if not file_path.exists():
            raise HTTPException(
                status_code=404,
                detail="Fichier PDF introuvable sur le serveur",
            )
        file_size = file_path.stat().st_size

    def _iter():
        # Yield from in-memory bytes (BD path) OR streamed disk (legacy).
        if file_data is not None:
            # 64 KiB chunks to match the legacy disk path's behaviour and
            # keep memory churn predictable on multi-MB PDFs.
            view = memoryview(file_data)
            for i in range(0, len(view), 64 * 1024):
                yield bytes(view[i:i + 64 * 1024])
        else:
            assert file_path is not None
            with open(file_path, "rb") as f:
                while True:
                    chunk = f.read(64 * 1024)
                    if not chunk:
                        break
                    yield chunk

    raw_filename = doc_info.get('original_filename') or doc_info['filename']
    # RFC 5987 — handle non-ASCII filenames (accents, etc.) safely. We send
    # both the legacy `filename=` (ASCII fallback with quotes/control chars
    # escaped) and the modern `filename*=UTF-8''…` (full Unicode).
    # Strip header-meaningful characters from the ASCII fallback so a malicious
    # uploaded filename (e.g. `evil";boundary=x.pdf` or `a;mode=evil.pdf`)
    # cannot inject extra Content-Disposition directives. The modern variant
    # is percent-encoded which is already safe.
    ascii_fallback = raw_filename.encode('ascii', 'replace').decode('ascii')
    ascii_safe = (
        ascii_fallback
        .replace('\\', '_')
        .replace('"', '_')
        .replace(';', '_')
        .replace('\n', '_')
        .replace('\r', '_')
    )
    encoded = urlquote(raw_filename, safe='')
    content_disposition = (
        f'inline; filename="{ascii_safe}"; filename*=UTF-8\'\'{encoded}'
    )
    return StreamingResponse(
        _iter(),
        media_type=doc_info.get('mime_type') or "application/pdf",
        headers={
            "Content-Disposition": content_disposition,
            "Cache-Control": "private, max-age=300",
            "Content-Length": str(file_size),
        },
    )


@router.get("/documents/{document_id}/page/{page_number}")
async def render_page(
    document_id: int,
    page_number: int,
    zoom: float = Query(default=1.0, ge=0.1, le=10.0, description="Facteur de zoom"),
    user: ErpUser = Depends(_require_tenant),
):
    """Rend une page du PDF en image PNG avec cache LRU."""
    _ensure_tables(user.schema)

    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouvé")

    if page_number < 0 or page_number >= doc_info['page_count']:
        raise HTTPException(
            status_code=400,
            detail=f"Page {page_number} invalide. Le document a {doc_info['page_count']} pages (0-{doc_info['page_count']-1})"
        )

    # Cache key: stable per-document identity (document id) — avoids the
    # disk path which may not exist post-redeploy. The schema scopes the key
    # to the tenant so two tenants with the same numeric id never collide.
    cache_key = f"doc:{user.schema}:{document_id}"

    # Check LRU cache first
    cached = _page_cache.get(cache_key, page_number, zoom)
    if cached is not None:
        return StreamingResponse(
            io.BytesIO(cached),
            media_type="image/png",
            headers={
                "Content-Disposition": f"inline; filename=page_{page_number}.png",
                "Cache-Control": "public, max-age=3600",
                "X-Cache": "HIT",
            }
        )

    if not _HAS_FITZ:
        raise HTTPException(status_code=500, detail="PyMuPDF (fitz) non installe sur le serveur")

    # Source primaire : BD. Fallback legacy : disque. Le pré-check
    # `has_file_data` évite un SELECT BYTEA inutile quand on sait déjà
    # qu'il est NULL (documents legacy uploadés avant la migration BYTEA).
    pdf_bytes: bytes | None = None
    if doc_info.get('has_file_data'):
        pdf_bytes = _db_get_document_data(user.schema, document_id)
    if pdf_bytes is None:
        file_path = _safe_file_path(UPLOAD_DIR, user.schema, doc_info['filename'])
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Fichier PDF introuvable sur le serveur")
        try:
            with open(file_path, "rb") as f:
                pdf_bytes = f.read()
        except IOError:
            logger.exception("Erreur lecture fichier disque")
            raise HTTPException(status_code=500, detail="Erreur lecture du fichier")

    try:
        pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = pdf_doc[page_number]
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        png_bytes = pix.tobytes("png")
        pdf_doc.close()
    except Exception:
        logger.exception(f"Erreur rendu page {page_number}")
        raise HTTPException(status_code=500, detail="Erreur rendu de la page")

    _page_cache.put(cache_key, page_number, zoom, png_bytes)

    return StreamingResponse(
        io.BytesIO(png_bytes),
        media_type="image/png",
        headers={
            "Content-Disposition": f"inline; filename=page_{page_number}.png",
            "Cache-Control": "public, max-age=3600",
            "X-Cache": "MISS",
        }
    )


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Supprime un document PDF et ses donnees associees."""
    _ensure_tables(user.schema)

    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouvé")

    # Invalidate the LRU page cache (keyed on doc:{schema}:{id} — see render_page).
    _page_cache.invalidate(f"doc:{user.schema}:{document_id}")
    # Best-effort cleanup of the legacy disk copy (no-op if BYTEA-only — most
    # post-migration documents). Silently ignored if file doesn't exist.
    try:
        file_path = _safe_file_path(UPLOAD_DIR, user.schema, doc_info['filename'])
        file_path.unlink(missing_ok=True)
    except Exception:
        # Path may be invalid (e.g. legacy docs with weird filenames) — the
        # row is still deleted from BD below.
        pass

    if not _db_delete_document(user.schema, document_id):
        raise HTTPException(status_code=404, detail="Document non trouvé")

    return {"status": "deleted"}


# =============================================================================
# API ENDPOINTS: CALIBRATIONS
# =============================================================================

@router.post(
    "/documents/{document_id}/calibrate",
    response_model=CalibrationResponse,
)
async def set_calibration(
    document_id: int,
    data: CalibrationCreate,
    user: ErpUser = Depends(_require_tenant),
):
    """Definit la calibration (echelle) pour une page du document."""
    _ensure_tables(user.schema)

    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouvé")

    if data.page_number >= doc_info['page_count']:
        raise HTTPException(
            status_code=400,
            detail=f"Page {data.page_number} invalide pour ce document"
        )

    result = _db_upsert_calibration(user.schema, document_id, data.model_dump())
    return result


@router.get(
    "/documents/{document_id}/calibration/{page_number}",
    response_model=CalibrationResponse,
)
async def get_calibration(
    document_id: int,
    page_number: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Recupere la calibration d'une page specifique."""
    _ensure_tables(user.schema)

    result = _db_get_calibration(user.schema, document_id, page_number)
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Aucune calibration pour la page {page_number}"
        )
    return result


@router.delete("/documents/{document_id}/calibration/{page_number}")
async def delete_calibration(
    document_id: int,
    page_number: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Supprime la calibration d'une page specifique."""
    _ensure_tables(user.schema)
    conn = _get_conn_for_tenant(user.schema)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM metre_calibrations WHERE document_id = %s AND page_number = %s",
            (document_id, page_number),
        )
        deleted = cursor.rowcount > 0
        conn.commit()
        cursor.close()
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=f"Aucune calibration pour la page {page_number}"
        )
    return {"status": "deleted"}


# =============================================================================
# API ENDPOINTS: MEASUREMENTS
# =============================================================================

@router.get(
    "/documents/{document_id}/measurements",
    response_model=list[MeasurementResponse],
)
async def list_measurements(
    document_id: int,
    page: Optional[int] = Query(None, ge=0, description="Filtrer par page"),
    layer_id: Optional[int] = Query(None, description="Filtrer par calque"),
    user: ErpUser = Depends(_require_tenant),
):
    """Liste les mesures d'un document avec filtres optionnels."""
    _ensure_tables(user.schema)

    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouvé")

    return _db_list_measurements(
        user.schema, document_id,
        page_number=page, layer_id=layer_id
    )


@router.post(
    "/documents/{document_id}/measurements",
    response_model=MeasurementResponse,
)
async def create_measurement(
    document_id: int,
    data: MeasurementCreate,
    user: ErpUser = Depends(_require_tenant),
):
    """Cree une nouvelle mesure sur le document."""
    _ensure_tables(user.schema)

    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouvé")

    if data.page_number >= doc_info['page_count']:
        raise HTTPException(
            status_code=400,
            detail=f"Page {data.page_number} invalide pour ce document"
        )

    # Guard against bloated metadata_json (DoS prevention)
    _validate_metadata_size(data.metadata_json)

    measurement_data = data.model_dump()
    measurement_data['points'] = [p.model_dump() for p in data.points]

    return _db_create_measurement(user.schema, document_id, measurement_data)


@router.get("/measurements/{measurement_id}", response_model=MeasurementResponse)
async def get_measurement_endpoint(
    measurement_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Recupere une mesure par son ID."""
    _ensure_tables(user.schema)
    result = _db_get_measurement(user.schema, measurement_id)
    if not result:
        raise HTTPException(status_code=404, detail="Mesure non trouvée")
    return result


@router.put("/measurements/{measurement_id}", response_model=MeasurementResponse)
async def update_measurement(
    measurement_id: int,
    data: MeasurementUpdate,
    user: ErpUser = Depends(_require_tenant),
):
    """Met a jour une mesure existante."""
    _ensure_tables(user.schema)

    # Guard against bloated metadata_json (DoS prevention)
    if data.metadata_json is not None:
        _validate_metadata_size(data.metadata_json)

    update_data = data.model_dump(exclude_unset=True)
    if 'points' in update_data and update_data['points'] is not None:
        update_data['points'] = [
            p.model_dump() if hasattr(p, 'model_dump') else p
            for p in update_data['points']
        ]

    result = _db_update_measurement(user.schema, measurement_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="Mesure non trouvée")
    return result


@router.delete("/measurements/{measurement_id}")
async def delete_measurement(
    measurement_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Supprime une mesure."""
    _ensure_tables(user.schema)

    if not _db_delete_measurement(user.schema, measurement_id):
        raise HTTPException(status_code=404, detail="Mesure non trouvée")
    return {"status": "deleted"}


@router.get("/documents/{document_id}/measurements/export")
async def export_measurements(
    document_id: int,
    format: ExportFormat = Query(ExportFormat.csv, description="Format d'export"),
    page: Optional[int] = Query(None, ge=0, description="Filtrer par page"),
    layer_id: Optional[int] = Query(None, description="Filtrer par calque"),
    user: ErpUser = Depends(_require_tenant),
):
    """Exporte les mesures d'un document en CSV ou JSON."""
    _ensure_tables(user.schema)

    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouvé")

    measurements = _db_list_measurements(
        user.schema, document_id,
        page_number=page, layer_id=layer_id
    )

    if format == ExportFormat.json:
        # Serialize datetime fields for JSON compatibility
        for m in measurements:
            for key in ('created_at', 'updated_at'):
                if key in m and m[key] is not None:
                    m[key] = str(m[key])
        return JSONResponse(
            content={"document_id": document_id, "measurements": measurements},
            headers={
                "Content-Disposition": f"attachment; filename=mesures_{document_id}.json"
            }
        )

    # CSV export
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "page", "type", "label", "value", "unit", "color", "layer_id",
        "points", "created_at"
    ])
    for m in measurements:
        writer.writerow([
            m.get('id'),
            m.get('page_number'),
            m.get('type'),
            m.get('label', ''),
            m.get('value'),
            m.get('unit'),
            m.get('color'),
            m.get('layer_id', ''),
            json.dumps(m.get('points', [])),
            m.get('created_at', ''),
        ])

    csv_bytes = output.getvalue().encode('utf-8-sig')
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename=mesures_{document_id}.csv"
        }
    )


# =============================================================================
# API ENDPOINTS: AI DETECTION (TAKEOFF AUTOMATIQUE)
# =============================================================================

@router.post(
    "/documents/{document_id}/ai-detect",
    response_model=AIDetectRunResult,
)
async def ai_detect_run(
    document_id: int,
    payload: AIDetectionRequest,
    user: ErpUser = Depends(_require_tenant),
):
    """Declenche une detection IA Claude Vision sur une page du PDF.

    Pre-conditions:
    - Calibration de la page existe (pour conversion pixels -> unite reelle)
    - Credits IA suffisants (pre-check + deduct apres)

    Cout: ~$0.10-0.30 par page (Claude Opus 4.7 Vision).
    """
    _ensure_tables(user.schema)

    # Lazy import to avoid circular import devis <-> metre_pdf
    from .devis import _call_claude

    # 1. Pre-check credits
    credits_ok, balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(
            status_code=402,
            detail=f"Credits IA insuffisants (balance: ${balance:.4f}). Recharge requise."
        )

    # 2. Verifier document existe
    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouve")

    page_number = payload.page_number
    # Round 15 fix: ERP_REACT convention is 1-based pageNumber (matches
    # CalibrationModal). Valid range is [1, page_count].
    if page_number < 1 or page_number > doc_info['page_count']:
        raise HTTPException(
            status_code=400,
            detail=f"Page {page_number} invalide (document a {doc_info['page_count']} pages)"
        )

    # 3. Verifier calibration
    calib = _db_get_calibration(user.schema, document_id, page_number)
    if not calib:
        raise HTTPException(
            status_code=400,
            detail=f"Calibration requise pour page {page_number}. Calibre l'echelle d'abord."
        )

    # 4. Recuperer PDF bytes
    pdf_bytes: Optional[bytes] = None
    if doc_info.get('has_file_data'):
        pdf_bytes = _db_get_document_data(user.schema, document_id)
    if pdf_bytes is None:
        file_path = _safe_file_path(UPLOAD_DIR, user.schema, doc_info['filename'])
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Fichier PDF introuvable")
        try:
            with open(file_path, "rb") as f:
                pdf_bytes = f.read()
        except IOError:
            logger.exception("Erreur lecture PDF")
            raise HTTPException(status_code=500, detail="Erreur lecture du PDF")

    # 5. Render page PNG haute resolution (DPI 200 + tuple retour avec dimensions)
    try:
        png_bytes, img_w, img_h = _render_page_for_vision(pdf_bytes, page_number, dpi=250)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erreur render page pour vision")
        raise HTTPException(status_code=500, detail="Erreur rendu de la page pour IA")

    img_b64 = base64.b64encode(png_bytes).decode('utf-8')

    # PHASE 2: BOM-aware mode - load tenant catalog filtered by section
    bom_products: Optional[list[dict]] = None
    section_label: Optional[str] = None
    if payload.use_bom_catalog and payload.section_numero:
        try:
            bom_products = _db_list_products_by_section(user.schema, payload.section_numero)
            if not bom_products:
                logger.warning(
                    "BOM-aware requested but no products found for section %s tenant %s",
                    payload.section_numero, user.schema,
                )
            else:
                section_label = payload.section_numero
        except Exception:
            logger.exception("Failed to load BOM products for section")
    elif payload.section_numero and not payload.use_bom_catalog:
        section_label = payload.section_numero  # juste pour le label, sans catalogue

    # 6. Build prompt + call Claude Vision
    prompt = _build_metre_vision_prompt(
        scale_factor=float(calib['scale_factor']),
        unit=calib['unit'],
        detection_types=payload.detection_types,
        additional_context=payload.additional_context,
        bom_products=bom_products,
        section_label=section_label,
        img_w=img_w,
        img_h=img_h,
    )

    try:
        # FIX-B7: wrap synchronous httpx call with asyncio.to_thread to avoid
        # blocking the FastAPI event loop ~30-60s on complex PDFs (EDGE-1, I2)
        message = await asyncio.to_thread(
            _call_claude,
            model="claude-opus-4-7",
            max_tokens=32000,
            system=None,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": img_b64,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }],
        )
    except Exception:
        # FIX-B2: avoid leaking exception details to client (Lecon #74)
        logger.exception("Claude Vision call failed")
        raise HTTPException(status_code=502, detail="Erreur lors de l'appel IA. Reessayez plus tard.")

    # 7. Parse response
    # FIX-B1: parse runs BEFORE billing intentionally; if parse fails (502 raised),
    # the user is NOT billed. Once parse succeeds, the Claude API cost is "sunk"
    # (real call already paid by us upstream), so even if 0 detections are returned
    # we proceed to billing in step 8 (cost is sunk after Claude call).
    response_text = ""
    for block in message.content:
        if hasattr(block, 'text'):
            response_text += block.text
    detections_raw = _parse_detections_json(response_text)

    # 8. Billing
    tokens_in = getattr(message.usage, 'input_tokens', 0) or 0
    tokens_out = getattr(message.usage, 'output_tokens', 0) or 0
    cache_creation = getattr(message.usage, 'cache_creation_input_tokens', 0) or 0
    cache_read = getattr(message.usage, 'cache_read_input_tokens', 0) or 0
    # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read
    cost_usd = (
        tokens_in * 15 / 1_000_000
        + tokens_out * 75 / 1_000_000
        + cache_creation * 18.75 / 1_000_000
        + cache_read * 1.50 / 1_000_000
    ) * 1.30  # 30% markup
    # FIX-B3: separate track_ai_usage from _deduct_credits so a failure in the
    # audit-only tracker does NOT skip credit deduction (would be a revenue leak).
    # Track usage (audit/logging only, recoverable later via re-tracking).
    try:
        track_ai_usage(user, "metre_ai_detect", tokens_in, tokens_out, cost_usd, 0, True)
    except Exception:
        logger.exception(
            "track_ai_usage failed for tenant=%s cost=%s (audit only, no revenue impact)",
            user.schema, cost_usd,
        )
    # Deduct credits - CRITIQUE (revenue impact). Use logger.error (no stack spam)
    # with explicit "CRITICAL" flag so ops alerting can pattern-match.
    try:
        _deduct_credits(user, cost_usd)
    except Exception:
        logger.error(
            "CRITICAL: _deduct_credits FAILED for tenant=%s cost=%s - REVENUE LEAK, "
            "manual deduct required",
            user.schema, cost_usd,
        )
        # We continue voluntarily: Claude call already ran, user is being served.
        # The CRITICAL log line must trigger an ops alert for manual reconciliation.

    # 9. Persist detections (status=pending)
    # Fix#2 : UNE seule transaction au lieu de N connexions. Si le worker
    # crash au milieu, soit tout est commit (success), soit rollback global
    # (etat coherent). FIX-B1/B3 above garantissent que le billing est deja
    # paye avant cette etape -- la persistance est best-effort dans la
    # transaction unique.
    try:
        saved = _db_create_ai_detections_bulk(
            user.schema, document_id, page_number,
            detections_raw,
            claude_model="claude-opus-4-7",
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost_usd,
            img_w=img_w,
            img_h=img_h,
        )
    except Exception:
        logger.exception(
            "Failed to bulk-persist AI detections (transaction rolled back)"
        )
        saved = []

    return AIDetectRunResult(
        detections=[AIDetectionResponse(**r) for r in saved],
        page_number=page_number,
        total=len(saved),
        cost_usd=cost_usd,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
    )


@router.post(
    "/documents/{document_id}/ai-detect-multi-section",
    response_model=AIDetectMultiSectionResult,
)
async def ai_detect_multi_section(
    document_id: int,
    payload: AIDetectMultiSectionRequest,
    user: ErpUser = Depends(_require_tenant),
):
    """Lance plusieurs detections IA sequentielles, une par section. PHASE 2.

    Chaque section utilise son catalogue BOM filtre + son layer dedie.
    Cout total = N * cout d'un detect (~$0.40 par section worst-case).
    """
    _ensure_tables(user.schema)

    # Lazy import to avoid circular import devis <-> metre_pdf
    from .devis import _call_claude

    # Round 8 C2 fix: validate + dedup + strip section items.
    # Pydantic max_length=5 already enforced; here we filter empty/whitespace
    # entries, dedup while preserving order, and re-validate post-dedup.
    cleaned_sections: list[str] = []
    seen_sections: set[str] = set()
    for raw_section in payload.sections:
        if not isinstance(raw_section, str):
            continue
        s = raw_section.strip()
        if not s or len(s) > 255 or s in seen_sections:
            continue
        seen_sections.add(s)
        cleaned_sections.append(s)
    if not cleaned_sections:
        raise HTTPException(
            status_code=400,
            detail="Aucune section valide fournie (chaines vides ou doublons uniquement).",
        )

    # Pre-check credits with safety margin
    credits_ok, balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(
            status_code=402,
            detail=f"Credits IA insuffisants (balance: ${balance:.4f})"
        )

    # Round 8 I4 fix: estimated_cost realistically ~$0.40 per section worst-case
    # (Opus 4.7 vision input + 8000 tokens output = up to $0.78 raw, but typical
    # output is much smaller). Use 0.30 as a conservative estimate, no 0.8 discount.
    estimated_cost = len(cleaned_sections) * 0.30
    if balance < estimated_cost:
        raise HTTPException(
            status_code=402,
            detail=(
                f"Credits insuffisants pour {len(cleaned_sections)} sections "
                f"(~${estimated_cost:.2f}). Balance: ${balance:.4f}"
            ),
        )

    # Verifier document
    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouve")

    page_number = payload.page_number
    # Round 15 fix: ERP_REACT convention is 1-based pageNumber (matches
    # CalibrationModal). Valid range is [1, page_count].
    if page_number < 1 or page_number > doc_info['page_count']:
        raise HTTPException(
            status_code=400,
            detail=f"Page {page_number} invalide (document a {doc_info['page_count']} pages)",
        )

    # Verifier calibration
    calib = _db_get_calibration(user.schema, document_id, page_number)
    if not calib:
        raise HTTPException(
            status_code=400,
            detail=f"Calibration requise pour page {page_number}.",
        )

    # Recuperer PDF bytes une seule fois
    pdf_bytes: Optional[bytes] = None
    if doc_info.get('has_file_data'):
        pdf_bytes = _db_get_document_data(user.schema, document_id)
    if pdf_bytes is None:
        file_path = _safe_file_path(UPLOAD_DIR, user.schema, doc_info['filename'])
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Fichier PDF introuvable")
        try:
            with open(file_path, "rb") as f:
                pdf_bytes = f.read()
        except IOError:
            logger.exception("Erreur lecture PDF")
            raise HTTPException(status_code=500, detail="Erreur lecture du PDF")

    # Render page une seule fois (DPI 200 + tuple retour avec dimensions)
    try:
        png_bytes, img_w, img_h = _render_page_for_vision(pdf_bytes, page_number, dpi=250)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erreur render page pour vision")
        raise HTTPException(status_code=500, detail="Erreur rendu de la page")

    img_b64 = base64.b64encode(png_bytes).decode('utf-8')

    # Files API beta: upload PNG once, reuse for N section calls (cost/bandwidth optim).
    # Best-effort: if upload fails, we fallback to base64 inline (no breakage).
    anthropic_file_id: Optional[str] = _upload_png_to_anthropic(png_bytes)

    # Loop sections (uses cleaned_sections from C2 fix above)
    sections_processed: list[str] = []
    sections_failed: list[str] = []
    sections_empty_bom: list[str] = []
    bom_truncated_sections: list[str] = []
    total_cost = 0.0
    total_tokens_in = 0
    total_tokens_out = 0
    detections_by_section: dict[str, int] = {}

    try:
        for section_num in cleaned_sections:
            try:
                bom_products = _db_list_products_by_section(user.schema, section_num)

                # Round 8 I3 fix: section without any BOM product = skip with explicit
                # marker. Avoid silently calling Claude without catalog and labelling
                # detections [SXX] when BOM-less.
                if not bom_products:
                    logger.info(
                        "Multi-section: section %s has 0 BOM products, skipping (tenant=%s doc=%s)",
                        section_num, user.schema, document_id,
                    )
                    sections_empty_bom.append(section_num)
                    continue

                # Track BOM truncation for user feedback (>50 products = lost in prompt)
                if len(bom_products) > 50:
                    bom_truncated_sections.append(section_num)

                # Layer dedie pour cette section si demande
                layer_id: Optional[int] = None
                if payload.auto_create_layer_per_section:
                    try:
                        layer = _db_get_or_create_section_layer(
                            user.schema, document_id, section_num
                        )
                        layer_id = layer['id']
                    except Exception:
                        logger.exception("Failed to create layer for section %s", section_num)

                # Build prompt with BOM (and image dimensions hint)
                prompt = _build_metre_vision_prompt(
                    scale_factor=float(calib['scale_factor']),
                    unit=calib['unit'],
                    detection_types=["surface", "distance", "count"],
                    additional_context=payload.additional_context,
                    bom_products=bom_products if bom_products else None,
                    section_label=section_num,
                    img_w=img_w,
                    img_h=img_h,
                )

                # Call Claude (Files API if upload succeeded, else fallback base64)
                try:
                    if anthropic_file_id:
                        message = await asyncio.to_thread(
                            _call_claude_vision_with_file,
                            anthropic_file_id, prompt, 32000,
                        )
                    else:
                        message = await asyncio.to_thread(
                            _call_claude,
                            model="claude-opus-4-7",
                            max_tokens=32000,
                            system=None,
                            messages=[{
                                "role": "user",
                                "content": [
                                    {
                                        "type": "image",
                                        "source": {
                                            "type": "base64",
                                            "media_type": "image/png",
                                            "data": img_b64,
                                        },
                                    },
                                    {"type": "text", "text": prompt},
                                ],
                            }],
                        )
                except Exception:
                    logger.exception("Claude Vision call failed for section %s", section_num)
                    sections_failed.append(section_num)
                    continue

                # Parse response
                response_text = ""
                for block in message.content:
                    if hasattr(block, 'text'):
                        response_text += block.text
                try:
                    detections_raw = _parse_detections_json(response_text)
                except HTTPException:
                    logger.exception("Parse failed for section %s", section_num)
                    sections_failed.append(section_num)
                    continue

                # Tokens / cost
                tokens_in = getattr(message.usage, 'input_tokens', 0) or 0
                tokens_out = getattr(message.usage, 'output_tokens', 0) or 0
                cache_creation = getattr(message.usage, 'cache_creation_input_tokens', 0) or 0
                cache_read = getattr(message.usage, 'cache_read_input_tokens', 0) or 0
                # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read
                cost_usd = (
                    tokens_in * 15 / 1_000_000
                    + tokens_out * 75 / 1_000_000
                    + cache_creation * 18.75 / 1_000_000
                    + cache_read * 1.50 / 1_000_000
                ) * 1.30  # 30% markup
                total_tokens_in += tokens_in
                total_tokens_out += tokens_out
                total_cost += cost_usd

                # Persist with layer_id and section in label
                saved_count = 0
                per_det_cost = cost_usd / max(1, len(detections_raw))
                for det in detections_raw:
                    if det.get('label'):
                        det['label'] = f"[S{section_num}] {det['label']}"
                    else:
                        det['label'] = f"[S{section_num}] {det.get('category', 'detection')}"
                    # Override layer via metadata (used at accept time)
                    det['_layer_id'] = layer_id
                    det['_section_numero'] = section_num
                    try:
                        _db_create_ai_detection(
                            user.schema, document_id, page_number, det,
                            claude_model="claude-opus-4-7",
                            tokens_in=tokens_in,
                            tokens_out=tokens_out,
                            cost_usd=per_det_cost,
                            claude_response={
                                "raw": det,
                                "section": section_num,
                                "layer_id": layer_id,
                            },
                            img_w=img_w,
                            img_h=img_h,
                        )
                        saved_count += 1
                    except Exception:
                        logger.exception(
                            "Failed to persist AI detection for section %s", section_num
                        )

                detections_by_section[section_num] = saved_count
                sections_processed.append(section_num)

                # Track usage per section (audit only)
                try:
                    track_ai_usage(
                        user, "metre_ai_detect_multi_section",
                        tokens_in, tokens_out, cost_usd, 0, True,
                    )
                except Exception:
                    logger.exception("track_ai_usage failed for section %s", section_num)

            except Exception:
                logger.exception("Section %s failed entirely", section_num)
                sections_failed.append(section_num)

        # Deduct credits total
        if total_cost > 0:
            try:
                _deduct_credits(user, total_cost)
            except Exception:
                logger.error(
                    "CRITICAL: _deduct_credits FAILED for tenant=%s total_cost=%s sections=%s "
                    "- REVENUE LEAK, manual deduct required",
                    user.schema, total_cost, cleaned_sections,
                )
    finally:
        # Cleanup uploaded Anthropic file (best-effort, non-critical)
        if anthropic_file_id:
            try:
                _delete_anthropic_file(anthropic_file_id)
            except Exception:
                logger.warning(
                    "Cleanup of Anthropic file %s failed (non-critical)", anthropic_file_id
                )

    return AIDetectMultiSectionResult(
        page_number=page_number,
        sections_processed=sections_processed,
        sections_failed=sections_failed,
        sections_empty_bom=sections_empty_bom,
        total_detections=sum(detections_by_section.values()),
        total_cost_usd=round(total_cost, 6),
        total_tokens_in=total_tokens_in,
        total_tokens_out=total_tokens_out,
        detections_by_section=detections_by_section,
        bom_truncated_sections=bom_truncated_sections,
    )


async def _run_quick_inventory_multi_pass(
    img_b64: str,
    query: str,
    additional_context: Optional[str],
    bom_products: Optional[list[dict]],
    section_label: Optional[str],
) -> dict:
    """Multi-pass orchestrator: Pass 1 (vision exhaustif) + Pass 2 (texte filtrage).

    Combats Claude's tendency to hallucinate context (e.g. inferring
    '(existante)' from spatial hatching). Pass 1 forces literal word-for-word
    reading of every label with explicit has_existante_annotation flag.
    Pass 2 applies the user filter on the extracted text (no vision needed).

    Cout: ~$0.60-0.80 par appel (vs ~$0.40 single-pass) mais precision
    drastiquement amelioree pour plans complexes ou labels ambigus.

    Returns dict avec inventory, summary, tokens_in, tokens_out, thinking_tokens
    sommes des 2 passes.
    """
    # PASS 1: scan exhaustif avec vision + Adaptive Thinking effort=high (default)
    # qui garantit raisonnement systematique sur Opus 4.7.
    pass1_prompt = _build_pass1_exhaustive_prompt()
    message1 = await asyncio.to_thread(
        _call_claude_vision_with_thinking,
        img_b64,
        pass1_prompt,
        10000,   # thinking_budget IGNORE sur Opus 4.7 (kept for backward compat)
        100000,  # max_response_tokens
    )
    pass1_text = _extract_text_from_thinking_response(message1)
    pass1_data = _parse_pass1_json(pass1_text)
    pass1_thinking = _count_thinking_tokens(message1)
    pass1_in = getattr(message1.usage, 'input_tokens', 0) or 0
    pass1_out = getattr(message1.usage, 'output_tokens', 0) or 0
    logger.info(
        "Multi-pass inventory: Pass 1 extracted %d labels (in=%d out=%d thinking=%d)",
        len(pass1_data.get("all_labels", [])),
        pass1_in, pass1_out, pass1_thinking,
    )

    # PASS 2: filtrage texte (pas de vision) avec thinking allege
    from .devis import _call_claude_with_thinking
    pass2_prompt = _build_pass2_filter_prompt(
        pass1_data=pass1_data,
        query=query,
        additional_context=additional_context,
        bom_products=bom_products,
        section_label=section_label,
    )
    # Pass 2 = filtrage simple sur les labels deja extraits par Pass 1, pas
    # besoin de raisonnement profond. effort="medium" preserve l'intention
    # originale d'un thinking allege (avant: thinking_budget=5000 ignore par
    # Opus 4.7 adaptive thinking).
    message2 = await asyncio.to_thread(
        lambda: _call_claude_with_thinking(
            max_response_tokens=20000,
            effort="medium",
            messages=[{"role": "user", "content": pass2_prompt}],
        )
    )
    pass2_text = ""
    for block in message2.content:
        if getattr(block, 'type', None) == 'text' and hasattr(block, 'text'):
            pass2_text += block.text
    pass2_data = _parse_quick_inventory_json(pass2_text)
    pass2_thinking = _count_thinking_tokens(message2)
    pass2_in = getattr(message2.usage, 'input_tokens', 0) or 0
    pass2_out = getattr(message2.usage, 'output_tokens', 0) or 0
    logger.info(
        "Multi-pass inventory: Pass 2 filtered to %d items (in=%d out=%d thinking=%d)",
        len(pass2_data.get("inventory", [])),
        pass2_in, pass2_out, pass2_thinking,
    )

    return {
        "inventory": pass2_data["inventory"],
        "summary": pass2_data["summary"],
        "pass1_label_count": len(pass1_data.get("all_labels", [])),
        "tokens_in": pass1_in + pass2_in,
        "tokens_out": pass1_out + pass2_out,
        "thinking_tokens": pass1_thinking + pass2_thinking,
    }


@router.post(
    "/documents/{document_id}/ai-quick-inventory",
    response_model=AIQuickInventoryResult,
)
async def ai_quick_inventory(
    document_id: int,
    payload: AIQuickInventoryRequest,
    user: ErpUser = Depends(_require_tenant),
):
    """Mode INVENTAIRE RAPIDE: Claude analyse le plan et retourne une liste
    texte structuree (item, dimensions, qty, notes) sans markup overlay.

    Plus precis que le mode markup pour plans manuscrits car Claude n'a
    pas a pointer des coordonnees exactes - juste lire les annotations.

    Modes:
    - precision_mode=False: single-pass standard (~$0.05-0.10/appel, rapide)
    - precision_mode=True : multi-pass (Pass 1 exhaustif + Pass 2 filtre)
                            (~$0.60-0.80/appel, precision elevee)
    """
    _ensure_tables(user.schema)

    # 1. Pre-check credits
    credits_ok, balance = _check_credits(user)
    if not credits_ok:
        raise HTTPException(
            status_code=402,
            detail=f"Credits IA insuffisants (balance: ${balance:.4f}). Recharge requise."
        )

    # 2. Verifier document
    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouve")

    page_number = payload.page_number
    if page_number < 1 or page_number > doc_info['page_count']:
        raise HTTPException(
            status_code=400,
            detail=f"Page {page_number} invalide (document a {doc_info['page_count']} pages)"
        )

    # 3. Recuperer PDF bytes
    pdf_bytes: Optional[bytes] = None
    if doc_info.get('has_file_data'):
        pdf_bytes = _db_get_document_data(user.schema, document_id)
    if pdf_bytes is None:
        file_path = _safe_file_path(UPLOAD_DIR, user.schema, doc_info['filename'])
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Fichier PDF introuvable")
        try:
            with open(file_path, "rb") as f:
                pdf_bytes = f.read()
        except IOError:
            logger.exception("Erreur lecture PDF (quick inventory)")
            raise HTTPException(status_code=500, detail="Erreur lecture du PDF")

    # 4. Render page (DPI 250 + clamp Opus 4.7)
    try:
        png_bytes, img_w, img_h = _render_page_for_vision(pdf_bytes, page_number, dpi=250)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Erreur render page pour vision (quick inventory)")
        raise HTTPException(status_code=500, detail="Erreur rendu de la page pour IA")
    img_b64 = base64.b64encode(png_bytes).decode('utf-8')

    # 5. BOM-aware (optionnel)
    bom_products: Optional[list[dict]] = None
    section_label: Optional[str] = None
    if payload.use_bom_catalog and payload.section_numero:
        try:
            bom_products = _db_list_products_by_section(user.schema, payload.section_numero)
            if bom_products:
                section_label = payload.section_numero
        except Exception:
            logger.exception("Failed to load BOM for quick inventory")

    # 6+7. Call Claude (multi-pass si precision, single-pass sinon) + parse
    thinking_tokens = 0
    if payload.precision_mode:
        # MULTI-PASS: Pass 1 (vision exhaustif litteral) + Pass 2 (texte filtrage).
        # Combat les hallucinations contextuelles (ex: "(existante)" infere depuis
        # hachures plutot que depuis le label texte).
        try:
            mp_result = await _run_quick_inventory_multi_pass(
                img_b64=img_b64,
                query=payload.query,
                additional_context=payload.additional_context,
                bom_products=bom_products,
                section_label=section_label,
            )
        except HTTPException:
            raise
        except Exception:
            logger.exception("Multi-pass inventory failed")
            raise HTTPException(status_code=502, detail="Erreur lors de l'appel IA. Reessaie plus tard.")
        parsed = {"inventory": mp_result["inventory"], "summary": mp_result["summary"]}
        tokens_in = mp_result["tokens_in"]
        tokens_out = mp_result["tokens_out"]
        thinking_tokens = mp_result["thinking_tokens"]
    else:
        # SINGLE-PASS RAPIDE: prompt monolitique sans thinking
        prompt = _build_quick_inventory_prompt(
            query=payload.query,
            additional_context=payload.additional_context,
            bom_products=bom_products,
            section_label=section_label,
        )
        from .devis import _call_claude  # lazy
        try:
            message = await asyncio.to_thread(
                _call_claude,
                model="claude-opus-4-7",
                max_tokens=32000,
                system=None,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": img_b64}},
                        {"type": "text", "text": prompt},
                    ],
                }],
            )
        except Exception:
            logger.exception("Claude Vision call failed (quick inventory)")
            raise HTTPException(status_code=502, detail="Erreur lors de l'appel IA. Reessaie plus tard.")
        response_text = ""
        for block in message.content:
            if hasattr(block, 'text'):
                response_text += block.text
        parsed = _parse_quick_inventory_json(response_text)
        tokens_in = getattr(message.usage, 'input_tokens', 0) or 0
        tokens_out = getattr(message.usage, 'output_tokens', 0) or 0

    # 8. Billing
    # Round 22A fix: thinking tokens are ALREADY included in tokens_out per
    # Anthropic doc. The `usage.thinking_tokens` field (when SDK exposes it)
    # is an INFORMATIONAL sub-total, NOT additional cost. Adding it again
    # caused silent double-billing (~$0.39 surcharge per precision call) once
    # the SDK starts populating that field. Use a single formula and treat
    # thinking_tokens as pure telemetry returned to the client.
    cache_creation = getattr(message.usage, 'cache_creation_input_tokens', 0) or 0
    cache_read = getattr(message.usage, 'cache_read_input_tokens', 0) or 0
    # Opus 4.7: $15/M input, $75/M output, $18.75/M cache write, $1.50/M cache read
    cost_usd = (
        tokens_in * 15 / 1_000_000
        + tokens_out * 75 / 1_000_000
        + cache_creation * 18.75 / 1_000_000
        + cache_read * 1.50 / 1_000_000
    ) * 1.30  # 30% markup
    feature_label = (
        "metre_ai_quick_inventory_precision"
        if payload.precision_mode
        else "metre_ai_quick_inventory"
    )
    try:
        track_ai_usage(user, feature_label, tokens_in, tokens_out, cost_usd, 0, True)
    except Exception:
        logger.exception("track_ai_usage failed (quick inventory)")
    try:
        _deduct_credits(user, cost_usd)
    except Exception:
        logger.error(
            "CRITICAL: _deduct_credits FAILED tenant=%s cost=%s - REVENUE LEAK",
            user.schema, cost_usd,
        )

    # 9. Validate items + auto-link product_id si BOM
    items: list[AIQuickInventoryItem] = []
    for raw in parsed["inventory"]:
        if not isinstance(raw, dict):
            continue
        try:
            # Validate product_id appartient au tenant
            pid = raw.get("product_id")
            if pid and isinstance(pid, int) and pid > 0:
                prod = _db_get_product(user.schema, pid)
                if not prod:
                    raw["product_id"] = None
            items.append(AIQuickInventoryItem(**raw))
        except Exception:
            logger.warning("Failed to parse inventory item: %s", raw)

    return AIQuickInventoryResult(
        page_number=page_number,
        inventory=items,
        summary=parsed["summary"][:1000] if isinstance(parsed.get("summary"), str) else "",
        total_items=len(items),
        cost_usd=cost_usd,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        claude_model="claude-opus-4-7",
        precision_mode_used=payload.precision_mode,
        thinking_tokens=thinking_tokens,
    )


@router.get(
    "/documents/{document_id}/ai-detections",
    response_model=list[AIDetectionResponse],
)
async def list_ai_detections(
    document_id: int,
    page_number: Optional[int] = Query(None, ge=0),
    status: Optional[str] = Query(None, pattern=r'^(pending|accepted|rejected|corrected)$'),
    user: ErpUser = Depends(_require_tenant),
):
    """Liste les detections IA d'un document, filtrables par page et status."""
    _ensure_tables(user.schema)
    doc = _db_get_document(user.schema, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document non trouve")
    rows = _db_list_ai_detections(user.schema, document_id, page_number, status)
    return [AIDetectionResponse(**r) for r in rows]


@router.put(
    "/ai-detections/{detection_id}",
    response_model=AIDetectionResponse,
)
async def update_ai_detection(
    detection_id: int,
    payload: AIDetectionStatusUpdate,
    user: ErpUser = Depends(_require_tenant),
):
    """Met a jour le status d'une detection IA (accept/reject/correct).

    Si payload.create_measurement = True et status = 'accepted', cree
    automatiquement un metre_measurements lie a cette detection.
    """
    _ensure_tables(user.schema)
    det = _db_get_ai_detection(user.schema, detection_id)
    if not det:
        raise HTTPException(status_code=404, detail="Detection non trouvee")

    measurement_id: Optional[int] = None
    if payload.create_measurement and payload.status == "accepted":
        # Map detection_type -> metre_measurements.type
        type_map = {"surface": "area", "distance": "distance", "count": "count"}
        m_type = type_map.get(det['detection_type'], 'distance')
        value = payload.user_correction_value if payload.user_correction_value is not None else det['detected_value']

        # PHASE 2: extract saved_layer_id and product_id from claude_response
        # if this detection came from the multi-section run.
        claude_resp = det.get('claude_response') or {}
        saved_layer_id = claude_resp.get('layer_id') if isinstance(claude_resp, dict) else None
        raw_det = claude_resp.get('raw') if isinstance(claude_resp, dict) else None
        if not isinstance(raw_det, dict):
            raw_det = {}
        ai_product_id: Optional[int] = None
        try:
            pid = raw_det.get('product_id')
            if isinstance(pid, int) and pid > 0:
                prod = _db_get_product(user.schema, pid)
                if prod:
                    ai_product_id = pid
        except Exception:
            logger.debug("Failed to extract product_id from claude_response")

        # FIX-B8 (Round 4 hardened): resolve a default layer_id so the new
        # measurement is visible in the frontend (filter `visibleLayerIds.has(m.layer)`
        # masks NULL layers). Round 4 R2: re-fetch after auto-create-fail so concurrent
        # accept-detection races (UNIQUE on metre_layers(doc, name) since R1) end up
        # with the SAME layer instead of NULL. If everything fails, propagate so the
        # user sees a clear error instead of an invisible measurement.
        default_layer_id: Optional[int] = None
        # PHASE 2: prefer the saved layer_id from multi-section runs.
        if isinstance(saved_layer_id, int) and saved_layer_id > 0:
            default_layer_id = saved_layer_id
        else:
            layers = _db_list_layers(user.schema, det['document_id'])
            visible_layers = [l for l in layers if l.get('visible', True)]
            if visible_layers:
                default_layer_id = visible_layers[0]['id']
            elif layers:
                default_layer_id = layers[0]['id']
            else:
                # Auto-create a "Detections IA" layer if document has none yet.
                # On UNIQUE conflict (concurrent worker won the race), re-fetch.
                try:
                    new_layer = _db_create_layer(user.schema, det['document_id'], {
                        'name': 'Detections IA',
                        'color': '#10B981',
                        'visible': True,
                        'locked': False,
                    })
                    default_layer_id = new_layer['id']
                except Exception:
                    logger.warning("Auto-create 'Detections IA' layer failed (likely race), retrying via list")
                    refetch = _db_list_layers(user.schema, det['document_id'])
                    if refetch:
                        default_layer_id = refetch[0]['id']
        if default_layer_id is None:
            raise HTTPException(
                status_code=500,
                detail="Impossible de resoudre une couche par defaut pour la mesure IA acceptee.",
            )
        m_data = {
            'page_number': det['page_number'],
            'type': m_type,
            'label': det.get('label'),
            'value': value,
            'unit': det.get('unit', 'pi.ca'),
            'points': det.get('points', []),
            'color': det.get('color', '#10B981'),
            'layer_id': default_layer_id,  # FIX-B8: critical for frontend visibility
            'quantity': 1,
            'product_id': ai_product_id,  # PHASE 2: BOM auto-link if Claude tagged it
            'metadata_json': {
                'source': 'ai_detection',
                'ai_detection_id': det['id'],
                'ai_confidence': float(det.get('confidence', 0.0) or 0.0),
                'ai_category': det.get('category'),
            },
        }
        m_row = _db_create_measurement(user.schema, det['document_id'], m_data)
        measurement_id = m_row['id']
        # Backlink ai_detection_id sur measurement
        # FIX-B4: conn = None before try so finally can safely test it (Lecon #100)
        conn = None
        try:
            conn = _get_conn_for_tenant(user.schema)
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE metre_measurements SET ai_detection_id = %s WHERE id = %s",
                (det['id'], measurement_id),
            )
            conn.commit()
            cursor.close()
        except Exception:
            logger.exception("Failed to backlink ai_detection_id on measurement")
        finally:
            if conn is not None:
                try:
                    db.reset_tenant(conn)
                except Exception:
                    pass
                try:
                    conn.close()
                except Exception:
                    pass

    updated = _db_update_ai_detection_status(
        user.schema, detection_id,
        status=payload.status,
        user_correction_value=payload.user_correction_value,
        measurement_id=measurement_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Detection non trouvee")
    return AIDetectionResponse(**updated)


# =============================================================================
# IMPORT METRE -> DEVIS LIGNES
# =============================================================================

@router.post(
    "/projects/{project_id}/import-to-devis/{devis_id}",
    response_model=ImportToDevisResponse,
)
async def import_metre_to_devis(
    project_id: int,
    devis_id: int,
    payload: ImportToDevisRequest,
    user: ErpUser = Depends(_require_tenant),
):
    """Importe les measurements d'un projet metre comme lignes de devis.

    Idempotence: skip les measurements deja lies a une devis_ligne du meme devis.
    """
    _ensure_tables(user.schema)

    # Validate project ownership
    proj = _db_get_project(user.schema, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Projet metre non trouve")

    # FIX-B5: defensive cross-project pollution check - if metre_project is already
    # bound to a different devis, refuse to push lines elsewhere.
    if proj.get('devis_id') and int(proj['devis_id']) != devis_id:
        raise HTTPException(
            status_code=400,
            detail=f"Le projet metre est deja lie au devis #{proj['devis_id']}. Import refuse.",
        )

    # Validate measurements appartiennent au project (via documents)
    measurement_ids = payload.measurement_ids
    # FIX-B4: conn = None BEFORE try so finally can safely test it (Lecon #100)
    conn = None
    lignes_created = 0
    total_montant = 0.0
    measurement_ids_imported: list[int] = []
    skipped_ids: list[int] = []
    try:
        conn = _get_conn_for_tenant(user.schema)
        cursor = conn.cursor()

        # FIX-B6: serialize concurrent imports on the SAME devis to avoid
        # MAX(sequence_ligne)+1 race -> duplicate sequence_ligne values.
        # Lock is held for the duration of the transaction (released on COMMIT/ROLLBACK).
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", (devis_id,))

        # Validate devis exists (search_path scopes to tenant; sanity check anyway).
        cursor.execute("SELECT id FROM devis WHERE id = %s", (devis_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Devis non trouve")

        # Fetch measurements valides (project match + product join)
        cursor.execute(
            """
            SELECT m.*, p.price as product_price, p.price_unit as product_unit, p.name as product_name
            FROM metre_measurements m
            JOIN metre_documents d ON d.id = m.document_id
            LEFT JOIN metre_products p ON p.id = m.product_id
            WHERE m.id = ANY(%s) AND d.project_id = %s
            """,
            (measurement_ids, project_id),
        )
        measurements = cursor.fetchall()

        valid_ids = {m['id'] for m in measurements}
        skipped_ids = [mid for mid in measurement_ids if mid not in valid_ids]

        # Idempotence: check existing devis_ligne_id
        cursor.execute(
            """
            SELECT id, devis_ligne_id FROM metre_measurements
            WHERE id = ANY(%s) AND devis_ligne_id IS NOT NULL
            """,
            (measurement_ids,),
        )
        existing_links = {r['id']: r['devis_ligne_id'] for r in cursor.fetchall()}

        # Get max sequence_ligne actuel (safe under advisory lock)
        cursor.execute(
            "SELECT COALESCE(MAX(sequence_ligne), 0) AS max_seq FROM devis_lignes WHERE devis_id = %s",
            (devis_id,),
        )
        seq_row = cursor.fetchone()
        next_seq = (seq_row['max_seq'] if seq_row else 0) + 1

        for m in measurements:
            if m['id'] in existing_links:
                skipped_ids.append(m['id'])
                continue

            description = m.get('label') or (m.get('product_name') or f"Mesure #{m['id']}")
            qte = float(m.get('quantity') or m.get('value') or 0)
            unite = m.get('unit') or 'un'
            prix = 0.0
            if payload.auto_price and m.get('product_price') is not None:
                prix = float(m['product_price'])
            montant = round(qte * prix, 2)
            total_montant += montant

            cursor.execute(
                """
                INSERT INTO devis_lignes (
                    devis_id, description, quantite, unite,
                    prix_unitaire, montant_ligne, sequence_ligne, categorie, notes_ligne
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    devis_id,
                    description,
                    qte,
                    unite,
                    prix,
                    montant,
                    next_seq,
                    payload.default_categorie,
                    f"Importe depuis metre_measurements#{m['id']}",
                ),
            )
            ligne_row = cursor.fetchone()
            ligne_id = ligne_row['id']
            next_seq += 1
            lignes_created += 1
            measurement_ids_imported.append(m['id'])

            # Backlink
            cursor.execute(
                "UPDATE metre_measurements SET devis_ligne_id = %s WHERE id = %s",
                (ligne_id, m['id']),
            )

        conn.commit()
        cursor.close()
    except HTTPException:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        raise
    except Exception:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        logger.exception("import_metre_to_devis failed")
        raise HTTPException(status_code=500, detail="Erreur lors de l'import vers le devis")
    finally:
        if conn is not None:
            try:
                db.reset_tenant(conn)
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass

    return ImportToDevisResponse(
        devis_id=devis_id,
        lignes_created=lignes_created,
        lignes_skipped=len(skipped_ids),
        measurement_ids_imported=measurement_ids_imported,
        measurement_ids_skipped=list(set(skipped_ids)),
        total_montant=round(total_montant, 2),
    )


# =============================================================================
# API ENDPOINTS: LAYERS
# =============================================================================

@router.get(
    "/documents/{document_id}/layers",
    response_model=list[LayerResponse],
)
async def list_layers(
    document_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Liste les calques de mesure d'un document."""
    _ensure_tables(user.schema)

    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouvé")
    return _db_list_layers(user.schema, document_id)


@router.post(
    "/documents/{document_id}/layers",
    response_model=LayerResponse,
)
async def create_layer(
    document_id: int,
    data: LayerCreate,
    user: ErpUser = Depends(_require_tenant),
):
    """Cree un nouveau calque de mesure."""
    _ensure_tables(user.schema)

    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouvé")
    return _db_create_layer(user.schema, document_id, data.model_dump())


@router.get("/layers/{layer_id}", response_model=LayerResponse)
async def get_layer_endpoint(
    layer_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Recupere un calque par son ID."""
    _ensure_tables(user.schema)
    result = _db_get_layer(user.schema, layer_id)
    if not result:
        raise HTTPException(status_code=404, detail="Calque non trouvé")
    return result


@router.put("/layers/{layer_id}", response_model=LayerResponse)
async def update_layer(
    layer_id: int,
    data: LayerUpdate,
    user: ErpUser = Depends(_require_tenant),
):
    """Met a jour un calque existant."""
    _ensure_tables(user.schema)

    result = _db_update_layer(
        user.schema, layer_id, data.model_dump(exclude_unset=True)
    )
    if not result:
        raise HTTPException(status_code=404, detail="Calque non trouvé")
    return result


@router.delete("/layers/{layer_id}")
async def delete_layer(
    layer_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Supprime un calque. Les mesures associees perdent leur affectation de calque."""
    _ensure_tables(user.schema)

    if not _db_delete_layer(user.schema, layer_id):
        raise HTTPException(status_code=404, detail="Calque non trouvé")
    return {"status": "deleted"}


# =============================================================================
# API ENDPOINTS: PRODUCTS
# =============================================================================

def _attach_components(schema: str, product: dict) -> dict:
    """Load composite components into a product dict (only if is_composite=true)."""
    if product.get('is_composite'):
        product['components'] = _db_list_components(schema, product['id'])
    else:
        product['components'] = []
    return product


def _db_list_components_for_parents(schema: str, parent_ids: list[int]) -> dict[int, list[dict]]:
    """Bulk-fetch all components for a list of parent products in a SINGLE query.

    Groups results by parent_product_id. Used by list_products to avoid the N+1
    pattern where each composite triggered its own _db_list_components query
    (200 composites = 201 round-trips).
    """
    if not parent_ids:
        return {}
    conn = _get_conn_for_tenant(schema)
    try:
        cursor = conn.cursor()
        # Use ANY(%s) with a list -- psycopg2 adapts python list -> postgres array.
        cursor.execute(
            """SELECT c.id, c.parent_product_id, c.child_product_id,
                      c.quantity_per_unit, c.formula, c.notes, c.sort_order,
                      p.name AS child_name, p.category AS child_category,
                      p.price AS child_price, p.price_unit AS child_price_unit,
                      p.waste_pct AS child_waste_pct, p.color AS child_color
               FROM metre_product_components c
               JOIN metre_products p ON p.id = c.child_product_id
               WHERE c.parent_product_id = ANY(%s)
               ORDER BY c.parent_product_id, c.sort_order, c.id""",
            (parent_ids,),
        )
        grouped: dict[int, list[dict]] = {pid: [] for pid in parent_ids}
        for row in cursor.fetchall():
            d = dict(row)
            grouped[d['parent_product_id']].append(d)
        cursor.close()
        return grouped
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            db.reset_tenant(conn)
        except Exception:
            pass
        conn.close()


@router.get("/products/sections", response_model=AvailableSectionsResponse)
async def list_product_sections(user: ErpUser = Depends(_require_tenant)):
    """List distinct numero_section values from the tenant's BOM catalog. PHASE 2.

    Declared BEFORE `/products/{product_id}` so the literal path matches first.
    """
    _ensure_tables(user.schema)
    sections = _db_list_distinct_sections(user.schema)
    return AvailableSectionsResponse(sections=sections, section_count=len(sections))


@router.get("/products", response_model=list[ProductResponse])
async def list_products(
    category: Optional[str] = Query(None, description="Filtrer par categorie"),
    user: ErpUser = Depends(_require_tenant),
):
    """Liste les produits du catalogue du tenant (components inclus pour les composites).

    Performance: bulk-fetch les components de tous les composites en 1 seule
    query (au lieu de N+1) via _db_list_components_for_parents.
    """
    _ensure_tables(user.schema)
    products = _db_list_products(user.schema, category=category)
    composite_ids = [p['id'] for p in products if p.get('is_composite')]
    components_by_parent = _db_list_components_for_parents(user.schema, composite_ids)
    for p in products:
        p['components'] = components_by_parent.get(p['id'], []) if p.get('is_composite') else []
    return products


@router.post("/products", response_model=ProductResponse)
async def create_product_endpoint(
    data: ProductCreate,
    user: ErpUser = Depends(_require_tenant),
):
    """Cree un nouveau produit dans le catalogue du tenant."""
    _ensure_tables(user.schema)
    result = _db_create_product(user.schema, data.model_dump(), user.user_id)
    return _attach_components(user.schema, result)


@router.post("/products/bulk-import", response_model=list[ProductResponse])
async def bulk_import_products(
    products: list[ProductCreate],
    user: ErpUser = Depends(_require_tenant),
):
    """Import en masse de produits dans le catalogue du tenant."""
    _ensure_tables(user.schema)
    product_dicts = [p.model_dump() for p in products]
    results = _db_bulk_upsert_products(user.schema, product_dicts, user.user_id)
    return [_attach_components(user.schema, r) for r in results]


@router.get("/products/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Recupere un produit par son ID (avec components si composite)."""
    _ensure_tables(user.schema)
    result = _db_get_product(user.schema, product_id)
    if not result:
        raise HTTPException(status_code=404, detail="Produit non trouvé")
    return _attach_components(user.schema, result)


@router.put("/products/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    data: ProductUpdate,
    user: ErpUser = Depends(_require_tenant),
):
    """Met a jour un produit existant."""
    _ensure_tables(user.schema)
    result = _db_update_product(
        user.schema, product_id, data.model_dump(exclude_unset=True)
    )
    if not result:
        raise HTTPException(status_code=404, detail="Produit non trouvé")
    return _attach_components(user.schema, result)


@router.delete("/products/{product_id}")
async def delete_product(
    product_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Supprime un produit (CASCADE supprime les components enfants)."""
    _ensure_tables(user.schema)
    if not _db_delete_product(user.schema, product_id):
        raise HTTPException(status_code=404, detail="Produit non trouvé")
    return {"status": "deleted"}


# =============================================================================
# API ENDPOINTS: PRODUCT COMPONENTS (Composite BOM)
# =============================================================================

@router.get(
    "/products/{product_id}/components",
    response_model=list[ProductComponentResponse],
)
async def list_product_components(
    product_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Liste les sous-produits d'un produit composite."""
    _ensure_tables(user.schema)
    parent = _db_get_product(user.schema, product_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Produit non trouvé")
    return _db_list_components(user.schema, product_id)


@router.post(
    "/products/{product_id}/components",
    response_model=ProductComponentResponse,
)
async def add_product_component(
    product_id: int,
    data: ProductComponentCreate,
    user: ErpUser = Depends(_require_tenant),
):
    """Attache un sous-produit a un produit composite (upsert sur (parent, child))."""
    _ensure_tables(user.schema)
    result = _db_create_component(user.schema, product_id, data.model_dump())
    # Re-attach child metadata for client convenience
    rows = _db_list_components(user.schema, product_id)
    for r in rows:
        if r['id'] == result['id']:
            return r
    return result


@router.put(
    "/products/{product_id}/components/{component_id}",
    response_model=ProductComponentResponse,
)
async def update_product_component(
    product_id: int,
    component_id: int,
    data: ProductComponentUpdate,
    user: ErpUser = Depends(_require_tenant),
):
    """Met a jour un composant (quantity_per_unit, notes, sort_order)."""
    _ensure_tables(user.schema)
    result = _db_update_component(
        user.schema, product_id, component_id, data.model_dump(exclude_unset=True)
    )
    if not result:
        raise HTTPException(status_code=404, detail="Composant non trouvé")
    # Re-attach denormalised child metadata for the response
    rows = _db_list_components(user.schema, product_id)
    for r in rows:
        if r['id'] == component_id:
            return r
    return result


@router.delete("/products/{product_id}/components/{component_id}")
async def delete_product_component(
    product_id: int,
    component_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Detache un sous-produit du composite parent."""
    _ensure_tables(user.schema)
    if not _db_delete_component(user.schema, product_id, component_id):
        raise HTTPException(status_code=404, detail="Composant non trouvé")
    return {"status": "deleted"}


# =============================================================================
# API ENDPOINTS: SNAP POINTS
# =============================================================================

def _detect_snap_points_sync(
    pdf_bytes: bytes,
    data: "SnapPointRequest",
) -> list[SnapPoint]:
    """Section synchrone de detect_snap_points: PyMuPDF + OpenCV + Hough.

    Extrait du endpoint pour pouvoir etre wrappee avec asyncio.to_thread()
    et eviter de bloquer l'event loop FastAPI 1-5s sur grosse page (FIX-#5).

    Raises:
        ImportError: si PyMuPDF (fitz) n'est pas disponible. Le caller doit
            le mapper sur HTTP 500.
        Exception: pour toute autre erreur (corruption PDF, etc.). Le caller
            doit le mapper sur HTTP 500.
    """
    if not _HAS_FITZ:
        raise ImportError("fitz not available")
    import numpy as np

    detected_points: list[SnapPoint] = []

    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = pdf_doc[data.page_number]

    zoom = 2.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)

    img_data = np.frombuffer(pix.samples, dtype=np.uint8)
    img = img_data.reshape(pix.h, pix.w, 3)

    pdf_doc.close()

    rx = int(data.region_x * zoom)
    ry = int(data.region_y * zoom)
    rw = int(data.region_width * zoom)
    rh = int(data.region_height * zoom)

    rx = max(0, min(rx, img.shape[1] - 1))
    ry = max(0, min(ry, img.shape[0] - 1))
    rw = min(rw, img.shape[1] - rx)
    rh = min(rh, img.shape[0] - ry)

    roi = img[ry:ry+rh, rx:rx+rw]

    if roi.size > 0:
        try:
            import cv2

            gray = cv2.cvtColor(roi, cv2.COLOR_RGB2GRAY)
            edges = cv2.Canny(gray, 50, 150, apertureSize=3)

            lines = cv2.HoughLinesP(
                edges, 1, np.pi / 180,
                threshold=30,
                minLineLength=20,
                maxLineGap=10
            )

            if lines is not None:
                endpoints = []
                midpoints = []

                for line in lines:
                    x1, y1, x2, y2 = line[0]
                    ox1 = (x1 / zoom) + data.region_x
                    oy1 = (y1 / zoom) + data.region_y
                    ox2 = (x2 / zoom) + data.region_x
                    oy2 = (y2 / zoom) + data.region_y

                    endpoints.append((ox1, oy1))
                    endpoints.append((ox2, oy2))
                    midpoints.append(((ox1 + ox2) / 2, (oy1 + oy2) / 2))

                tolerance = data.tolerance
                used = set()
                for i, (x1, y1) in enumerate(endpoints):
                    if i in used:
                        continue
                    cluster = [(x1, y1)]
                    for j, (x2, y2) in enumerate(endpoints):
                        if j <= i or j in used:
                            continue
                        if abs(x1 - x2) < tolerance and abs(y1 - y2) < tolerance:
                            cluster.append((x2, y2))
                            used.add(j)
                    used.add(i)

                    avg_x = sum(p[0] for p in cluster) / len(cluster)
                    avg_y = sum(p[1] for p in cluster) / len(cluster)

                    if len(cluster) >= 2:
                        detected_points.append(SnapPoint(
                            x=round(avg_x, 2),
                            y=round(avg_y, 2),
                            type=SnapPointType.intersection,
                        ))
                    else:
                        detected_points.append(SnapPoint(
                            x=round(avg_x, 2),
                            y=round(avg_y, 2),
                            type=SnapPointType.endpoint,
                        ))

                for mx, my in midpoints:
                    detected_points.append(SnapPoint(
                        x=round(mx, 2),
                        y=round(my, 2),
                        type=SnapPointType.midpoint,
                    ))

            corners = cv2.cornerHarris(gray, 2, 3, 0.04)
            corners = cv2.dilate(corners, None)
            threshold_val = 0.01 * corners.max() if corners.max() > 0 else 0

            if threshold_val > 0:
                corner_points = np.argwhere(corners > threshold_val)
                for pt in corner_points[:50]:
                    cy, cx = pt
                    ox = round((cx / zoom) + data.region_x, 2)
                    oy = round((cy / zoom) + data.region_y, 2)
                    detected_points.append(SnapPoint(
                        x=ox, y=oy,
                        type=SnapPointType.endpoint,
                    ))

        except ImportError:
            logger.warning("OpenCV non disponible. Detection limitee aux coins PDF.")

    return detected_points


@router.post(
    "/documents/{document_id}/snap-points",
    response_model=SnapPointResponse,
)
async def detect_snap_points(
    document_id: int,
    data: SnapPointRequest,
    user: ErpUser = Depends(_require_tenant),
):
    """Detecte les points d'accrochage dans une region de la page."""
    _ensure_tables(user.schema)
    start_time = time.time()

    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouvé")

    if data.page_number >= doc_info['page_count']:
        raise HTTPException(
            status_code=400,
            detail=f"Page {data.page_number} invalide pour ce document"
        )

    if data.region_width > MAX_SNAP_REGION_PX or data.region_height > MAX_SNAP_REGION_PX:
        raise HTTPException(
            status_code=400,
            detail=f"Region trop grande. Maximum: {MAX_SNAP_REGION_PX}x{MAX_SNAP_REGION_PX} pixels"
        )

    # Source primaire : BD. Fallback legacy : disque. Pré-check `has_file_data`
    # pour éviter un SELECT BYTEA inutile sur documents legacy disque-only.
    pdf_bytes: bytes | None = None
    if doc_info.get('has_file_data'):
        pdf_bytes = _db_get_document_data(user.schema, document_id)
    if pdf_bytes is None:
        file_path = _safe_file_path(UPLOAD_DIR, user.schema, doc_info['filename'])
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Fichier PDF introuvable sur le serveur")
        try:
            with open(file_path, "rb") as f:
                pdf_bytes = f.read()
        except IOError:
            logger.exception("Erreur lecture fichier disque (snap-points)")
            raise HTTPException(status_code=500, detail="Erreur lecture du fichier")

    # FIX-#5: wrap synchronous PyMuPDF + OpenCV + Hough work with
    # asyncio.to_thread to avoid blocking the FastAPI event loop pendant
    # 1-5s sur grosse page. Meme pattern que FIX-B7 (asyncio.to_thread sur
    # appel httpx synchrone Claude Vision).
    try:
        detected_points = await asyncio.to_thread(
            _detect_snap_points_sync, pdf_bytes, data
        )
    except ImportError:
        logger.error("PyMuPDF (fitz) non installe")
        raise HTTPException(
            status_code=500,
            detail="PyMuPDF requis pour la detection de points"
        )
    except Exception:
        logger.exception("Erreur detection snap points")
        raise HTTPException(status_code=500, detail="Erreur detection snap points")

    elapsed_ms = round((time.time() - start_time) * 1000, 2)

    return SnapPointResponse(
        points=detected_points,
        page_number=data.page_number,
        detection_time_ms=elapsed_ms,
    )


# =============================================================================
# API ENDPOINTS: SUMMARY
# =============================================================================

@router.get(
    "/documents/{document_id}/summary",
    response_model=MeasurementSummaryResponse,
)
async def get_measurement_summary(
    document_id: int,
    user: ErpUser = Depends(_require_tenant),
):
    """Resume des mesures d'un document: totaux par type et par calque."""
    _ensure_tables(user.schema)

    doc_info = _db_get_document(user.schema, document_id)
    if not doc_info:
        raise HTTPException(status_code=404, detail="Document non trouvé")

    summary = _db_get_measurement_summary(user.schema, document_id)

    return MeasurementSummaryResponse(
        document_id=document_id,
        total_measurements=summary['total_measurements'],
        by_type=[
            MeasurementSummaryItem(
                type=item['type'],
                count=item['count'],
                total_value=float(item['total_value'] or 0),
                unit=item['unit'],
            )
            for item in summary['by_type']
        ],
        by_layer=[
            MeasurementSummaryItem(
                type=item['type'],
                layer_name=item.get('layer_name'),
                count=item['count'],
                total_value=float(item['total_value'] or 0),
                unit=item['unit'],
            )
            for item in summary['by_layer']
        ],
    )
