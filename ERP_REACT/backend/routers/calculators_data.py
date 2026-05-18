"""
ERP React - Calculators Constants and Reference Tables
Ported from Streamlit calculator_ui.py + docs/30-49-calculateur-*.md specs.

Contains all lookup tables (materials, densities, AWG, DFU, WSFU,
snow loads, wood sections, metal profiles, welding electrodes, etc.)
plus the Claude Opus 4.6 system prompt for Quebec construction expertise.
"""

# ============================================
# METAL DENSITIES + PRICES (20+ materials)
# Source: docs/49-calculateur-poids-metaux.md
# kg/m3 density + indicative CAD/kg market price 2024
# ============================================

METAUX = {
    "acier_a36":      {"label": "Acier carbone A36",      "densite": 7850, "prix_cad_kg": 1.20},
    "acier_inox_304": {"label": "Acier inox 304",          "densite": 7930, "prix_cad_kg": 4.50},
    "acier_inox_316": {"label": "Acier inox 316",          "densite": 8000, "prix_cad_kg": 5.50},
    "acier_inox_430": {"label": "Acier inox 430",          "densite": 7750, "prix_cad_kg": 3.50},
    "acier_outil":    {"label": "Acier a outil",           "densite": 7850, "prix_cad_kg": 8.00},
    "alu_6061":       {"label": "Aluminium 6061-T6",       "densite": 2700, "prix_cad_kg": 5.00},
    "alu_5052":       {"label": "Aluminium 5052-H32",      "densite": 2680, "prix_cad_kg": 4.80},
    "alu_7075":       {"label": "Aluminium 7075-T6",       "densite": 2810, "prix_cad_kg": 12.00},
    "cuivre":         {"label": "Cuivre C11000",           "densite": 8940, "prix_cad_kg": 12.00},
    "laiton":         {"label": "Laiton C36000",           "densite": 8500, "prix_cad_kg": 8.00},
    "bronze":         {"label": "Bronze phosphoreux",      "densite": 8800, "prix_cad_kg": 15.00},
    "titane_gr2":     {"label": "Titane Grade 2",          "densite": 4510, "prix_cad_kg": 35.00},
    "titane_gr5":     {"label": "Titane Grade 5",          "densite": 4430, "prix_cad_kg": 45.00},
    "zinc":           {"label": "Zinc",                    "densite": 7130, "prix_cad_kg": 3.50},
    "plomb":          {"label": "Plomb",                   "densite": 11340, "prix_cad_kg": 2.50},
    "nickel":         {"label": "Nickel 200",              "densite": 8890, "prix_cad_kg": 25.00},
    "inconel":        {"label": "Inconel 625",             "densite": 8440, "prix_cad_kg": 60.00},
    "magnesium":      {"label": "Magnesium AZ31B",         "densite": 1770, "prix_cad_kg": 8.00},
    "fonte_grise":    {"label": "Fonte grise",             "densite": 7200, "prix_cad_kg": 1.50},
    "fonte_ductile":  {"label": "Fonte ductile",           "densite": 7100, "prix_cad_kg": 2.00},
}

# Retro-compatible short keys (acier, inox, aluminium, cuivre)
METAL_DENSITIES_LEGACY = {
    "acier": 7850, "inox": 7930, "aluminium": 2700, "cuivre": 8960,
}


# ============================================
# W-PROFILES (AISC / CISC)
# Source: docs/49-calculateur-poids-metaux.md + AISC Shapes Database
# W{hauteur_mm}x{masse_kg_m}
# ============================================

PROFILES_W = {
    "W150x13":  {"h": 148, "bf": 100, "tw": 4.3, "tf": 4.9,  "masse_kg_m": 13.0, "ix_mm4": 6.84e6},
    "W150x18":  {"h": 153, "bf": 102, "tw": 5.8, "tf": 7.1,  "masse_kg_m": 18.0, "ix_mm4": 9.20e6},
    "W150x24":  {"h": 160, "bf": 102, "tw": 6.6, "tf": 10.3, "masse_kg_m": 24.0, "ix_mm4": 13.4e6},
    "W200x22":  {"h": 206, "bf": 102, "tw": 6.2, "tf": 8.0,  "masse_kg_m": 22.3, "ix_mm4": 20.0e6},
    "W200x27":  {"h": 207, "bf": 133, "tw": 5.8, "tf": 8.4,  "masse_kg_m": 26.6, "ix_mm4": 25.8e6},
    "W200x36":  {"h": 201, "bf": 165, "tw": 6.2, "tf": 10.2, "masse_kg_m": 35.9, "ix_mm4": 34.5e6},
    "W200x46":  {"h": 203, "bf": 203, "tw": 7.2, "tf": 11.0, "masse_kg_m": 46.1, "ix_mm4": 45.8e6},
    "W250x33":  {"h": 258, "bf": 146, "tw": 6.1, "tf": 9.1,  "masse_kg_m": 32.7, "ix_mm4": 48.9e6},
    "W250x45":  {"h": 266, "bf": 148, "tw": 7.6, "tf": 13.0, "masse_kg_m": 44.8, "ix_mm4": 71.1e6},
    "W250x58":  {"h": 252, "bf": 203, "tw": 8.0, "tf": 13.5, "masse_kg_m": 58.0, "ix_mm4": 87.3e6},
    "W310x38":  {"h": 310, "bf": 165, "tw": 5.8, "tf": 8.9,  "masse_kg_m": 38.7, "ix_mm4": 85.0e6},
    "W310x52":  {"h": 317, "bf": 167, "tw": 7.6, "tf": 13.2, "masse_kg_m": 52.0, "ix_mm4": 118.0e6},
    "W310x74":  {"h": 310, "bf": 205, "tw": 9.4, "tf": 16.3, "masse_kg_m": 74.0, "ix_mm4": 165.0e6},
    "W360x39":  {"h": 352, "bf": 128, "tw": 6.5, "tf": 10.7, "masse_kg_m": 39.0, "ix_mm4": 102.0e6},
    "W360x57":  {"h": 358, "bf": 172, "tw": 7.9, "tf": 13.1, "masse_kg_m": 57.0, "ix_mm4": 160.0e6},
    "W360x72":  {"h": 350, "bf": 204, "tw": 8.6, "tf": 15.1, "masse_kg_m": 72.0, "ix_mm4": 201.0e6},
    "W360x91":  {"h": 353, "bf": 254, "tw": 9.5, "tf": 16.4, "masse_kg_m": 91.0, "ix_mm4": 266.0e6},
    "W410x46":  {"h": 403, "bf": 140, "tw": 6.9, "tf": 11.2, "masse_kg_m": 46.1, "ix_mm4": 156.0e6},
    "W410x67":  {"h": 410, "bf": 179, "tw": 8.8, "tf": 14.4, "masse_kg_m": 67.0, "ix_mm4": 246.0e6},
    "W410x85":  {"h": 417, "bf": 181, "tw": 10.9, "tf": 18.2, "masse_kg_m": 85.0, "ix_mm4": 316.0e6},
    "W460x74":  {"h": 457, "bf": 190, "tw": 9.0, "tf": 14.5, "masse_kg_m": 74.0, "ix_mm4": 333.0e6},
    "W530x66":  {"h": 525, "bf": 165, "tw": 8.9, "tf": 11.4, "masse_kg_m": 66.0, "ix_mm4": 351.0e6},
    "W530x92":  {"h": 533, "bf": 209, "tw": 10.2, "tf": 15.6, "masse_kg_m": 92.0, "ix_mm4": 552.0e6},
    "W610x125": {"h": 612, "bf": 229, "tw": 11.9, "tf": 19.6, "masse_kg_m": 125.0, "ix_mm4": 985.0e6},
}


# ============================================
# C-PROFILES (UPN / CISC channels)
# ============================================

PROFILES_C = {
    "C75x6":   {"h": 76,  "bf": 35,  "tw": 4.3, "tf": 6.9,  "masse_kg_m": 5.9},
    "C100x8":  {"h": 102, "bf": 40,  "tw": 4.8, "tf": 7.5,  "masse_kg_m": 8.3},
    "C130x10": {"h": 127, "bf": 47,  "tw": 4.8, "tf": 8.1,  "masse_kg_m": 10.4},
    "C150x12": {"h": 152, "bf": 48,  "tw": 5.1, "tf": 8.7,  "masse_kg_m": 12.2},
    "C180x15": {"h": 178, "bf": 58,  "tw": 5.3, "tf": 9.3,  "masse_kg_m": 14.6},
    "C200x18": {"h": 203, "bf": 57,  "tw": 5.6, "tf": 9.9,  "masse_kg_m": 17.9},
    "C230x22": {"h": 229, "bf": 63,  "tw": 6.1, "tf": 10.5, "masse_kg_m": 21.9},
    "C250x30": {"h": 254, "bf": 69,  "tw": 7.9, "tf": 11.1, "masse_kg_m": 29.8},
    "C310x31": {"h": 305, "bf": 74,  "tw": 7.2, "tf": 12.7, "masse_kg_m": 30.8},
    "C380x50": {"h": 381, "bf": 86,  "tw": 10.2, "tf": 16.5, "masse_kg_m": 50.4},
}


# ============================================
# CONCRETE DOSAGES (CSA A23.1)
# Source: docs/35-calculateur-beton.md
# Mix proportions kg per m3 for each strength class
# ============================================

DOSAGES_BETON = {
    "15MPa": {"ciment": 250, "sable": 800, "gravier": 1100, "eau": 175, "ec_ratio": 0.65},
    "20MPa": {"ciment": 300, "sable": 750, "gravier": 1100, "eau": 180, "ec_ratio": 0.60},
    "25MPa": {"ciment": 350, "sable": 700, "gravier": 1100, "eau": 175, "ec_ratio": 0.50},
    "30MPa": {"ciment": 400, "sable": 650, "gravier": 1100, "eau": 170, "ec_ratio": 0.43},
    "32MPa": {"ciment": 420, "sable": 625, "gravier": 1100, "eau": 165, "ec_ratio": 0.40},
    "35MPa": {"ciment": 450, "sable": 600, "gravier": 1100, "eau": 160, "ec_ratio": 0.36},
    "40MPa": {"ciment": 500, "sable": 550, "gravier": 1100, "eau": 155, "ec_ratio": 0.31},
}

# CSA A23.1 exposure classes
CLASSES_BETON = {
    "C-1": {"description": "Residentiel interieur",         "resistance_mpa": 20, "ec_max": 0.65, "air_pct": 5, "enrobage_mm": 20},
    "C-2": {"description": "Residentiel exterieur",          "resistance_mpa": 25, "ec_max": 0.55, "air_pct": 6, "enrobage_mm": 40},
    "C-3": {"description": "Commercial",                     "resistance_mpa": 30, "ec_max": 0.50, "air_pct": 6, "enrobage_mm": 50},
    "C-4": {"description": "Structural",                     "resistance_mpa": 32, "ec_max": 0.45, "air_pct": 5, "enrobage_mm": 50},
    "F-1": {"description": "Fondations",                     "resistance_mpa": 25, "ec_max": 0.55, "air_pct": 5, "enrobage_mm": 75},
    "S-1": {"description": "Haute resistance",               "resistance_mpa": 35, "ec_max": 0.40, "air_pct": 5, "enrobage_mm": 50},
    "S-2": {"description": "Tres haute resistance",          "resistance_mpa": 40, "ec_max": 0.35, "air_pct": 4, "enrobage_mm": 50},
}

# Reinforcing bars (CSA G30.18 metric)
BARRES_ARMATURE = {
    "10M": {"diametre_mm": 11.3, "aire_mm2": 100, "masse_kg_m": 0.785},
    "15M": {"diametre_mm": 16.0, "aire_mm2": 200, "masse_kg_m": 1.570},
    "20M": {"diametre_mm": 19.5, "aire_mm2": 300, "masse_kg_m": 2.355},
    "25M": {"diametre_mm": 25.2, "aire_mm2": 500, "masse_kg_m": 3.925},
    "30M": {"diametre_mm": 29.9, "aire_mm2": 700, "masse_kg_m": 5.495},
    "35M": {"diametre_mm": 35.7, "aire_mm2": 1000, "masse_kg_m": 7.850},
    "45M": {"diametre_mm": 43.7, "aire_mm2": 1500, "masse_kg_m": 11.775},
    "55M": {"diametre_mm": 56.4, "aire_mm2": 2500, "masse_kg_m": 19.625},
}

# Strength gain coefficient (ACI 209)
ACI_209 = {
    "GU": {"a": 4.0, "b": 0.85, "description": "General Use (Type GU/I)"},
    "HE": {"a": 2.3, "b": 0.92, "description": "High Early (Type HE/III)"},
    "MS": {"a": 4.0, "b": 0.85, "description": "Moderate Sulphate (Type MS/II)"},
    "HS": {"a": 4.0, "b": 0.85, "description": "High Sulphate (Type HS/V)"},
}

# Cure time minimum (days) by temperature range
CURE_TIME_MIN = {
    "above_20": 3,
    "10_20":    5,
    "5_10":     7,
    "0_5":     10,
}

# Excavation swell factors
FOISONNEMENT = {
    "terre_ordinaire": 1.25,
    "argile":          1.30,
    "sable":           1.15,
    "gravier":         1.12,
    "roc":             1.50,
}

# Safe slope ratios (CNESST) - H:V for trench
PENTES_TALUS_CNESST = {
    "roc":           {"ratio_h_v": 0.1, "angle_deg": 84, "description": "Roc solide"},
    "argile_dure":   {"ratio_h_v": 1.0, "angle_deg": 45, "description": "Argile dure"},
    "argile_molle":  {"ratio_h_v": 1.5, "angle_deg": 34, "description": "Argile molle"},
    "sable":         {"ratio_h_v": 1.5, "angle_deg": 34, "description": "Sable"},
    "sol_meuble":    {"ratio_h_v": 2.0, "angle_deg": 27, "description": "Sol meuble"},
}


# ============================================
# ELECTRICAL (CCE / Canadian Electrical Code)
# ============================================

# Complete AWG table (14 to 4/0)
AWG_TABLE = [
    {"awg": "14",  "section_mm2": 2.08,  "ampacite_60": 15,  "ampacite_75": 20,  "ampacite_90": 25},
    {"awg": "12",  "section_mm2": 3.31,  "ampacite_60": 20,  "ampacite_75": 25,  "ampacite_90": 30},
    {"awg": "10",  "section_mm2": 5.26,  "ampacite_60": 30,  "ampacite_75": 35,  "ampacite_90": 40},
    {"awg": "8",   "section_mm2": 8.37,  "ampacite_60": 40,  "ampacite_75": 50,  "ampacite_90": 55},
    {"awg": "6",   "section_mm2": 13.30, "ampacite_60": 55,  "ampacite_75": 65,  "ampacite_90": 75},
    {"awg": "4",   "section_mm2": 21.15, "ampacite_60": 70,  "ampacite_75": 85,  "ampacite_90": 95},
    {"awg": "3",   "section_mm2": 26.67, "ampacite_60": 85,  "ampacite_75": 100, "ampacite_90": 110},
    {"awg": "2",   "section_mm2": 33.63, "ampacite_60": 95,  "ampacite_75": 115, "ampacite_90": 130},
    {"awg": "1",   "section_mm2": 42.41, "ampacite_60": 110, "ampacite_75": 130, "ampacite_90": 150},
    {"awg": "1/0", "section_mm2": 53.49, "ampacite_60": 125, "ampacite_75": 150, "ampacite_90": 170},
    {"awg": "2/0", "section_mm2": 67.43, "ampacite_60": 145, "ampacite_75": 175, "ampacite_90": 195},
    {"awg": "3/0", "section_mm2": 85.03, "ampacite_60": 165, "ampacite_75": 200, "ampacite_90": 225},
    {"awg": "4/0", "section_mm2": 107.2, "ampacite_60": 195, "ampacite_75": 230, "ampacite_90": 260},
]

# Copper resistivity (ohm.mm2/m at 75C)
RESISTIVITE_CUIVRE = 0.0214
RESISTIVITE_ALUMINIUM = 0.0350

# Standard service ratings (amps)
CALIBRES_SERVICE = [100, 125, 150, 200, 400, 600]

# Lighting reference levels (lux) per CCE / Quebec code
ECLAIRAGE_NIVEAUX = {
    "salon":       {"lux_min": 100, "lux_recommande": 150},
    "cuisine":     {"lux_min": 200, "lux_recommande": 300},
    "chambre":     {"lux_min": 100, "lux_recommande": 150},
    "bureau":      {"lux_min": 300, "lux_recommande": 500},
    "atelier":     {"lux_min": 300, "lux_recommande": 500},
    "couloir":     {"lux_min": 50,  "lux_recommande": 100},
    "salle_bain":  {"lux_min": 150, "lux_recommande": 300},
    "industriel":  {"lux_min": 500, "lux_recommande": 750},
    "commercial":  {"lux_min": 300, "lux_recommande": 500},
}


# ============================================
# PLUMBING (CNP)
# Source: docs/33-calculateur-plomberie.md
# ============================================

# Drainage Fixture Units
DFU_APPAREILS = {
    "toilette":       {"label": "Toilette",                "dfu": 4,  "wsfu": 2.5},
    "lavabo":         {"label": "Lavabo",                  "dfu": 1,  "wsfu": 1.5},
    "douche":         {"label": "Douche",                  "dfu": 2,  "wsfu": 3.0},
    "baignoire":      {"label": "Baignoire",               "dfu": 3,  "wsfu": 3.0},
    "evier_cuisine":  {"label": "Evier cuisine",           "dfu": 2,  "wsfu": 2.0},
    "evier_bar":      {"label": "Evier bar",               "dfu": 1,  "wsfu": 1.5},
    "lave_vaisselle": {"label": "Lave-vaisselle",          "dfu": 2,  "wsfu": 1.5},
    "machine_laver":  {"label": "Machine a laver",         "dfu": 3,  "wsfu": 2.5},
    "drain_plancher": {"label": "Drain de plancher",       "dfu": 1,  "wsfu": 0},
    "urinoir":        {"label": "Urinoir",                 "dfu": 4,  "wsfu": 3.0},
}

# Drain diameter by DFU (CNP Table 2.3.3.5)
DIAMETRES_DRAIN = [
    {"dfu_max": 1,   "pouces": "1-1/4",  "mm": 32},
    {"dfu_max": 3,   "pouces": "1-1/2",  "mm": 38},
    {"dfu_max": 6,   "pouces": "2",      "mm": 50},
    {"dfu_max": 20,  "pouces": "2-1/2",  "mm": 63},
    {"dfu_max": 42,  "pouces": "3",      "mm": 75},
    {"dfu_max": 160, "pouces": "4",      "mm": 100},
    {"dfu_max": 620, "pouces": "5",      "mm": 125},
    {"dfu_max": 1400, "pouces": "6",     "mm": 150},
]

# Hazen-Williams C coefficients
HAZEN_WILLIAMS_C = {
    "cuivre":            140,
    "pex":               140,
    "cpvc":              140,
    "pvc":               140,
    "abs":               140,
    "acier_galv_neuf":   120,
    "acier_galv_usage":  100,
    "fonte_neuve":       130,
    "fonte_usee":        100,
    "beton":             130,
}

# Water heater sizing (gallons) by bedrooms + bathrooms
CHAUFFE_EAU_CAPACITE = {
    "1-1":  40,   # 1 bedroom, 1 bath
    "2-1":  40,
    "2-2":  50,
    "3-2":  50,
    "3-3":  60,
    "4-2":  60,
    "4-3":  80,
    "5-3":  80,
    "5-4":  100,
}


# ============================================
# HVAC (ASHRAE + Quebec climate)
# Source: docs/32-calculateur-hvac.md
# ============================================

# Heat loss factor W/m2 by insulation level
HVAC_FACTORS = {
    "faible":     {"label": "Faible (RSI < 2)",    "watts_m2": 50},
    "moyenne":    {"label": "Moyenne (RSI 2-4)",    "watts_m2": 40},
    "bonne":      {"label": "Bonne (RSI 4-6)",      "watts_m2": 30},
    "excellente": {"label": "Excellente (RSI > 6)",  "watts_m2": 22},
}

# Quebec climate zones (multiplier applied to heat loss)
ZONES_CLIMATIQUES = {
    "montreal":    {"label": "Montreal/Laval",       "facteur": 1.0, "t_hiver_c": -23, "t_ete_c": 30, "hdd": 4500},
    "quebec":      {"label": "Quebec/Levis",         "facteur": 1.1, "t_hiver_c": -27, "t_ete_c": 28, "hdd": 5100},
    "gatineau":    {"label": "Gatineau/Outaouais",   "facteur": 1.05, "t_hiver_c": -25, "t_ete_c": 30, "hdd": 4700},
    "sherbrooke":  {"label": "Sherbrooke/Estrie",    "facteur": 1.08, "t_hiver_c": -26, "t_ete_c": 29, "hdd": 5000},
    "saguenay":    {"label": "Saguenay-Lac-St-Jean", "facteur": 1.25, "t_hiver_c": -29, "t_ete_c": 27, "hdd": 5600},
    "rimouski":    {"label": "Bas-Saint-Laurent",    "facteur": 1.15, "t_hiver_c": -24, "t_ete_c": 25, "hdd": 5200},
    "val_dor":     {"label": "Abitibi-Temiscamingue", "facteur": 1.3, "t_hiver_c": -30, "t_ete_c": 26, "hdd": 6200},
    "nord":        {"label": "Nord du Quebec",       "facteur": 1.4, "t_hiver_c": -35, "t_ete_c": 24, "hdd": 6800},
}

# Air changes per hour (ACH) by room type
ACH_RECOMMANDE = {
    "salon":         4,
    "chambre":       4,
    "cuisine":       8,
    "salle_bain":    8,
    "sous_sol":      3,
    "garage":        6,
    "atelier":       10,
    "commercial":    6,
    "restaurant":    12,
    "laboratoire":   15,
}

# Duct velocity recommendations (FPM = feet per minute)
VITESSES_CONDUIT = {
    "residentiel_principal": {"min": 600,  "max": 900},
    "residentiel_branche":   {"min": 400,  "max": 600},
    "commercial":            {"min": 1000, "max": 1500},
    "industriel":            {"min": 1500, "max": 2500},
}

# Solar Heat Gain Coefficient by window orientation
SHGC_ORIENTATION = {
    "nord": 0.4, "sud": 0.8, "est": 0.9, "ouest": 1.0, "mixte": 0.7,
}


# ============================================
# WOOD STRUCTURAL (CSA O86)
# ============================================

BOIS_DIMENSIONS = {
    "2x4":  {"b": 38, "d": 89,  "label": "2x4"},
    "2x6":  {"b": 38, "d": 140, "label": "2x6"},
    "2x8":  {"b": 38, "d": 184, "label": "2x8"},
    "2x10": {"b": 38, "d": 235, "label": "2x10"},
    "2x12": {"b": 38, "d": 286, "label": "2x12"},
    "3x6":  {"b": 64, "d": 140, "label": "3x6"},
    "3x8":  {"b": 64, "d": 184, "label": "3x8"},
    "3x10": {"b": 64, "d": 235, "label": "3x10"},
    "3x12": {"b": 64, "d": 286, "label": "3x12"},
    "4x8":  {"b": 89, "d": 184, "label": "4x8"},
    "4x10": {"b": 89, "d": 235, "label": "4x10"},
    "4x12": {"b": 89, "d": 286, "label": "4x12"},
    "6x6":  {"b": 140, "d": 140, "label": "6x6"},
    "6x8":  {"b": 140, "d": 184, "label": "6x8"},
}

BOIS_PROPRIETES = {
    "SPF_No2":     {"fb": 11.8, "fv": 1.5,  "E": 9500,  "name": "SPF No.2 (Epinette-Pin-Sapin)"},
    "SPF_No1":     {"fb": 17.2, "fv": 1.5,  "E": 11000, "name": "SPF No.1"},
    "DougFir_No2": {"fb": 14.5, "fv": 1.75, "E": 12500, "name": "Douglas Fir No.2"},
    "DougFir_No1": {"fb": 20.0, "fv": 1.75, "E": 13500, "name": "Douglas Fir No.1"},
    "Hemlock_No2": {"fb": 13.1, "fv": 1.5,  "E": 10000, "name": "Hem-Fir No.2"},
}

LVL_DIMENSIONS = {
    "1.75x7.25":   {"b": 44, "d": 184, "label": "1-3/4 x 7-1/4"},
    "1.75x9.25":   {"b": 44, "d": 235, "label": "1-3/4 x 9-1/4"},
    "1.75x11.25":  {"b": 44, "d": 286, "label": "1-3/4 x 11-1/4"},
    "1.75x11.875": {"b": 44, "d": 302, "label": "1-3/4 x 11-7/8"},
    "1.75x14":     {"b": 44, "d": 356, "label": "1-3/4 x 14"},
    "1.75x16":     {"b": 44, "d": 406, "label": "1-3/4 x 16"},
    "1.75x18":     {"b": 44, "d": 457, "label": "1-3/4 x 18"},
    "3.5x9.25":    {"b": 89, "d": 235, "label": "3-1/2 x 9-1/4"},
    "3.5x11.25":   {"b": 89, "d": 286, "label": "3-1/2 x 11-1/4"},
    "3.5x11.875":  {"b": 89, "d": 302, "label": "3-1/2 x 11-7/8"},
    "3.5x14":      {"b": 89, "d": 356, "label": "3-1/2 x 14"},
    "3.5x16":      {"b": 89, "d": 406, "label": "3-1/2 x 16"},
}

LVL_PROPRIETES = {
    "2.0E": {"fb": 28.2, "fv": 2.6, "E": 13800, "name": "2.0E LVL"},
    "2.2E": {"fb": 30.0, "fv": 2.6, "E": 15200, "name": "2.2E LVL"},
}

LIMITES_FLECHE = {
    "plancher": {"ratio": 360, "description": "L/360"},
    "toit":     {"ratio": 180, "description": "L/180"},
    "linteau":  {"ratio": 360, "description": "L/360"},
}

# Snow loads ground level (kPa) per CNBC
CHARGES_NEIGE = {
    "QC": {
        "Montreal": 2.6, "Laval": 2.6, "Longueuil": 2.6,
        "Quebec": 3.5, "Levis": 3.5, "Sherbrooke": 3.0,
        "Trois-Rivieres": 2.8, "Gatineau": 2.4, "Saguenay": 4.0,
        "Rimouski": 3.8, "Val-d'Or": 4.2, "Rouyn-Noranda": 4.0,
        "Baie-Comeau": 4.5, "Sept-Iles": 5.0, "Gaspe": 4.0,
    },
    "ON": {"Toronto": 1.1, "Ottawa": 2.4, "Sudbury": 3.0, "Thunder Bay": 2.2},
    "BC": {"Vancouver": 1.8, "Victoria": 1.2, "Kelowna": 2.5},
    "AB": {"Calgary": 1.6, "Edmonton": 1.8},
}


# ============================================
# ROOFING (CCQ 9.26)
# Source: docs/34-calculateur-toiture.md
# ============================================

# Pitch factors (1:12 to 18:12)
PENTES_TOITURE = {
    "1:12":  1.003, "2:12":  1.014, "3:12":  1.031, "4:12":  1.054,
    "5:12":  1.083, "6:12":  1.118, "7:12":  1.158, "8:12":  1.202,
    "9:12":  1.250, "10:12": 1.302, "11:12": 1.357, "12:12": 1.414,
    "14:12": 1.537, "16:12": 1.667, "18:12": 1.803,
}

# Dead load weights (lb/ft2) by roofing type
CHARGES_MORTES_TOITURE = {
    "bardeaux_asphalte":   2.5,
    "membrane_elastomere": 1.5,
    "membrane_tpo":        1.2,
    "membrane_epdm":       1.4,
    "tole_galvanisee":     1.5,
    "tole_peinte":         1.5,
    "tuiles_beton":        10.0,
    "ardoise":             15.0,
    "cedre":               3.5,
    "contreplaque":        3.0,
    "structure":           5.0,
    "plafond":             2.0,
}

# Roofing materials catalog (cost per square)
MATERIAUX_TOITURE = {
    "bardeau_3tabs":       {"label": "Bardeau 3 tabs 20 ans",    "cout_carre": 90,  "cout_pose": 150},
    "bardeau_architect":   {"label": "Bardeau architectural 30a", "cout_carre": 120, "cout_pose": 175},
    "bardeau_premium":     {"label": "Bardeau premium 50 ans",   "cout_carre": 200, "cout_pose": 200},
    "membrane_elastomere": {"label": "Membrane elastomere",       "cout_carre": 300, "cout_pose": 275},
    "membrane_tpo":        {"label": "Membrane TPO blanche",      "cout_carre": 350, "cout_pose": 250},
    "membrane_epdm":       {"label": "Membrane EPDM noire",       "cout_carre": 280, "cout_pose": 250},
    "tole_galvanisee":     {"label": "Tole galvanisee",           "cout_carre": 150, "cout_pose": 200},
    "tole_peinte":         {"label": "Tole d'acier peinte",       "cout_carre": 200, "cout_pose": 200},
}

# Gutter capacities (sq ft roof drainage)
GOUTTIERES_CAPACITE = {
    "4po": 600,
    "5po": 1000,
    "6po": 1400,
    "7po": 2000,
}


# ============================================
# PAINTING (SSPC/NACE + Quebec practices)
# Source: docs/48-calculateur-peinture.md
# ============================================

# Paint types: solids % / coverage m2/L / DFT um / VOC / drying
TYPES_PEINTURE = {
    "latex_interieur":   {"label": "Latex interieur",       "solides_pct": 35, "couverture_m2_l": 10, "dft_um": 35,  "voc": 50,  "sec_h": 1,  "recouvrement_h": 4,  "complet_h": 24,  "prix_l": 45},
    "latex_exterieur":   {"label": "Latex exterieur",       "solides_pct": 40, "couverture_m2_l": 9,  "dft_um": 45,  "voc": 100, "sec_h": 2,  "recouvrement_h": 6,  "complet_h": 48,  "prix_l": 55},
    "alkyde_interieur":  {"label": "Alkyde interieur",      "solides_pct": 45, "couverture_m2_l": 12, "dft_um": 40,  "voc": 350, "sec_h": 6,  "recouvrement_h": 16, "complet_h": 72,  "prix_l": 60},
    "alkyde_exterieur":  {"label": "Alkyde exterieur",      "solides_pct": 50, "couverture_m2_l": 11, "dft_um": 45,  "voc": 400, "sec_h": 8,  "recouvrement_h": 24, "complet_h": 96,  "prix_l": 70},
    "appret_latex":      {"label": "Appret latex",          "solides_pct": 30, "couverture_m2_l": 8,  "dft_um": 25,  "voc": 50,  "sec_h": 1,  "recouvrement_h": 2,  "complet_h": 24,  "prix_l": 40},
    "appret_alkyde":     {"label": "Appret alkyde",         "solides_pct": 40, "couverture_m2_l": 10, "dft_um": 30,  "voc": 350, "sec_h": 4,  "recouvrement_h": 16, "complet_h": 72,  "prix_l": 50},
    "appret_shellac":    {"label": "Appret shellac",        "solides_pct": 25, "couverture_m2_l": 8,  "dft_um": 20,  "voc": 730, "sec_h": 0.25, "recouvrement_h": 0.75, "complet_h": 8,  "prix_l": 65},
    "epoxy_2k":          {"label": "Epoxy 2K",              "solides_pct": 70, "couverture_m2_l": 6,  "dft_um": 100, "voc": 250, "sec_h": 4,  "recouvrement_h": 8,  "complet_h": 168, "prix_l": 120},
    "polyurethane_2k":   {"label": "Polyurethane 2K",       "solides_pct": 55, "couverture_m2_l": 8,  "dft_um": 60,  "voc": 350, "sec_h": 2,  "recouvrement_h": 4,  "complet_h": 168, "prix_l": 95},
    "peinture_plancher": {"label": "Peinture plancher",     "solides_pct": 45, "couverture_m2_l": 8,  "dft_um": 75,  "voc": 150, "sec_h": 4,  "recouvrement_h": 8,  "complet_h": 168, "prix_l": 75},
}

# Surface absorption factors (multiplier on coverage)
FACTEURS_ABSORPTION = {
    "gypse_neuf":      1.3,
    "gypse_peint":     1.0,
    "platre":          1.4,
    "beton_neuf":      1.5,
    "beton_scelle":    1.0,
    "bois_neuf":       1.3,
    "bois_peint":      1.0,
    "metal":           0.9,
    "stucco":          1.6,
    "brique":          1.5,
}

# Transfer efficiency by application method
EFFICACITE_TRANSFERT = {
    "pinceau":         0.95,
    "rouleau":         0.90,
    "airless":         0.65,
    "hvlp":            0.80,
    "electrostatique": 0.90,
    "conventionnel":   0.50,
}


# ============================================
# WELDING (CSA W47.1, W59, AWS D1.1)
# Source: docs/46-calculateur-soudure.md
# ============================================

# SMAW coated electrodes
ELECTRODES_SMAW = {
    "E6010": {"label": "E6010", "resistance_mpa": 414, "positions": "toutes",   "courant": "DCEP",   "penetration": "profonde", "usage": "Racine, pipeline, reparation"},
    "E6011": {"label": "E6011", "resistance_mpa": 414, "positions": "toutes",   "courant": "AC/DCEP", "penetration": "profonde", "usage": "Reparation, acier sale"},
    "E6013": {"label": "E6013", "resistance_mpa": 414, "positions": "toutes",   "courant": "AC/DC",  "penetration": "legere",   "usage": "Tole mince, apprentissage"},
    "E7014": {"label": "E7014", "resistance_mpa": 483, "positions": "1G-2G-1F-2F", "courant": "AC/DC", "penetration": "moyenne", "usage": "Production, remplissage rapide"},
    "E7018": {"label": "E7018", "resistance_mpa": 483, "positions": "toutes",   "courant": "AC/DCEP", "penetration": "moyenne", "usage": "Structure, bas-H, qualite X-ray"},
    "E7024": {"label": "E7024", "resistance_mpa": 483, "positions": "1G-2G-1F-2F", "courant": "AC/DC", "penetration": "legere", "usage": "Production plate"},
    "E308L-16": {"label": "E308L-16", "resistance_mpa": 517, "positions": "toutes", "courant": "AC/DCEP", "penetration": "moyenne", "usage": "Inox 304"},
    "E309L-16": {"label": "E309L-16", "resistance_mpa": 517, "positions": "toutes", "courant": "AC/DCEP", "penetration": "moyenne", "usage": "Acier carbone vers inox"},
    "E316L-16": {"label": "E316L-16", "resistance_mpa": 517, "positions": "toutes", "courant": "AC/DCEP", "penetration": "moyenne", "usage": "Inox 316, corrosif"},
}

# GMAW (MIG) filler metals
FILS_GMAW = {
    "ER70S-6":  {"label": "ER70S-6",  "resistance_mpa": 483, "gaz": "C25 (75Ar/25CO2)", "usage": "Acier doux construction"},
    "ER70S-3":  {"label": "ER70S-3",  "resistance_mpa": 483, "gaz": "C25 ou 100% CO2",  "usage": "Acier propre"},
    "ER80S-D2": {"label": "ER80S-D2", "resistance_mpa": 552, "gaz": "C25",              "usage": "Acier haute resistance"},
    "ER308L":   {"label": "ER308L",   "resistance_mpa": 517, "gaz": "98% Ar / 2% O2",    "usage": "Inox 304"},
    "ER316L":   {"label": "ER316L",   "resistance_mpa": 517, "gaz": "98% Ar / 2% O2",    "usage": "Inox 316"},
    "ER4043":   {"label": "ER4043",   "resistance_mpa": 193, "gaz": "100% Argon",        "usage": "Aluminium 6061/3003"},
    "ER5356":   {"label": "ER5356",   "resistance_mpa": 262, "gaz": "100% Argon",        "usage": "Aluminium 5052/5083 marine"},
}

# Protection gases
GAZ_PROTECTION = {
    "co2_100":   {"label": "100% CO2",           "debit_l_min": "15-20", "usage": "Acier carbone penetration profonde"},
    "c25":       {"label": "C25 (75%Ar/25%CO2)", "debit_l_min": "15-20", "usage": "Acier carbone standard"},
    "c10":       {"label": "C10 (90%Ar/10%CO2)", "debit_l_min": "15-22", "usage": "Acier carbone transfert spray"},
    "ar_100":    {"label": "100% Argon",          "debit_l_min": "12-18", "usage": "Aluminium, inox TIG, non-ferreux"},
    "ar_98_o2":  {"label": "98% Ar / 2% O2",       "debit_l_min": "15-20", "usage": "Inox MIG"},
    "tri_mix":   {"label": "Tri-Mix (90Ar/8CO2/2O2)", "debit_l_min": "15-20", "usage": "Inox/acier fin"},
}

# Deposition rate (kg/h) by process
TAUX_DEPOT = {
    "SMAW": {"min": 1.0, "max": 3.0,  "efficacite": 0.25},
    "GMAW": {"min": 2.0, "max": 8.0,  "efficacite": 0.40},
    "FCAW": {"min": 2.5, "max": 10.0, "efficacite": 0.35},
    "GTAW": {"min": 0.3, "max": 1.5,  "efficacite": 0.20},
    "SAW":  {"min": 5.0, "max": 20.0, "efficacite": 0.50},
}

# Electrode efficiency waste factor
ELECTRODE_WASTE = {
    "SMAW": 1.4,   # 40% waste (stub loss)
    "GMAW": 1.05,  # 5% waste (high efficiency)
    "FCAW": 1.15,  # 15% waste
    "GTAW": 1.02,
    "SAW":  1.05,
}


# ============================================
# BENDING (sheet metal)
# Source: docs/47-calculateur-pliage.md
# ============================================

# K-factor by R/T ratio (position of neutral axis)
K_FACTOR_TABLE = [
    {"r_t": 0.0, "k": 0.50},
    {"r_t": 0.5, "k": 0.46},
    {"r_t": 1.0, "k": 0.41},
    {"r_t": 1.5, "k": 0.39},
    {"r_t": 2.0, "k": 0.38},
    {"r_t": 2.5, "k": 0.36},
    {"r_t": 3.0, "k": 0.34},
    {"r_t": 5.0, "k": 0.33},
    {"r_t": 10.0, "k": 0.32},
]

# Material bending properties
MATERIAUX_PLIAGE = {
    "acier_doux_a36": {"label": "Acier doux A36",    "limite_elast_mpa": 250, "resistance_mpa": 400, "module_gpa": 200, "k_factor": 0.33, "rmin_facteur": 0.5, "tonnage_facteur": 1.0, "springback_90": 0.5},
    "inox_304":       {"label": "Inox 304",           "limite_elast_mpa": 215, "resistance_mpa": 505, "module_gpa": 193, "k_factor": 0.35, "rmin_facteur": 0.5, "tonnage_facteur": 1.5, "springback_90": 2.0},
    "inox_316":       {"label": "Inox 316",           "limite_elast_mpa": 290, "resistance_mpa": 580, "module_gpa": 193, "k_factor": 0.35, "rmin_facteur": 0.5, "tonnage_facteur": 1.6, "springback_90": 2.5},
    "alu_6061_t6":    {"label": "Aluminium 6061-T6",  "limite_elast_mpa": 275, "resistance_mpa": 310, "module_gpa": 69,  "k_factor": 0.30, "rmin_facteur": 1.5, "tonnage_facteur": 0.45, "springback_90": 3.0},
    "alu_5052_h32":   {"label": "Aluminium 5052-H32", "limite_elast_mpa": 195, "resistance_mpa": 228, "module_gpa": 70,  "k_factor": 0.30, "rmin_facteur": 1.0, "tonnage_facteur": 0.35, "springback_90": 2.5},
    "cuivre":         {"label": "Cuivre",             "limite_elast_mpa": 70,  "resistance_mpa": 220, "module_gpa": 110, "k_factor": 0.33, "rmin_facteur": 1.0, "tonnage_facteur": 0.5, "springback_90": 1.5},
    "titane_gr2":     {"label": "Titane Grade 2",      "limite_elast_mpa": 275, "resistance_mpa": 345, "module_gpa": 103, "k_factor": 0.30, "rmin_facteur": 2.5, "tonnage_facteur": 1.3, "springback_90": 4.0},
    "galvanise":      {"label": "Acier galvanise",     "limite_elast_mpa": 250, "resistance_mpa": 390, "module_gpa": 200, "k_factor": 0.33, "rmin_facteur": 0.8, "tonnage_facteur": 1.0, "springback_90": 1.0},
}

# V-die opening by thickness
V_DIE_OPENING = [
    {"epaisseur_max_mm": 3,  "v_facteur": 6},
    {"epaisseur_max_mm": 6,  "v_facteur": 8},
    {"epaisseur_max_mm": 12, "v_facteur": 10},
    {"epaisseur_max_mm": 25, "v_facteur": 12},
]


# ============================================
# STAIRS (CCQ 9.8 / 3.4)
# Source: docs/30-calculateur-escaliers.md
# ============================================

ESCALIERS_CCQ = {
    "residentiel": {
        "label":             "Residentiel (CCQ 9.8)",
        "contremarche_min":  125,
        "contremarche_max":  200,
        "contremarche_opt":  175,
        "giron_min":         235,
        "giron_max":         355,
        "giron_opt":         280,
        "largeur_min":       860,
        "hauteur_libre_min": 1950,
        "main_courante_h_min": 865,
        "main_courante_h_max": 965,
        "main_courante_diam": 38,
        "barreaux_max":      100,
    },
    "commercial": {
        "label":             "Commercial (CCQ 3.4)",
        "contremarche_min":  125,
        "contremarche_max":  180,
        "contremarche_opt":  170,
        "giron_min":         280,
        "giron_max":         355,
        "giron_opt":         300,
        "largeur_min":       1100,
        "hauteur_libre_min": 2050,
        "main_courante_h_min": 865,
        "main_courante_h_max": 965,
        "main_courante_diam": 38,
        "barreaux_max":      100,
        "garde_corps_h_min": 1070,
    },
}

# Blondel formula optimal range (2R + G)
BLONDEL_MIN = 580
BLONDEL_MAX = 660
BLONDEL_OPT = 630

ESSENCES_BOIS_ESCALIER = {
    "pin":     {"label": "Pin (Quebec)",  "densite_kg_m3": 500, "prix_m3": 1200},
    "epinette": {"label": "Epinette",      "densite_kg_m3": 470, "prix_m3": 1100},
    "erable":  {"label": "Erable",         "densite_kg_m3": 700, "prix_m3": 2800},
    "chene":   {"label": "Chene rouge",    "densite_kg_m3": 700, "prix_m3": 3200},
    "merisier": {"label": "Merisier",     "densite_kg_m3": 690, "prix_m3": 3000},
}


# ============================================
# TAXES QUEBEC
# ============================================

TPS_RATE = 0.05
TVQ_RATE = 0.09975


# ============================================
# CCQ PAYROLL (charge tributaire)
# ============================================

TAUX_DEDUCTIONS_EMPLOYE = {
    "rrq":              0.064,    # 6.4% (2024)
    "rqap":             0.00494,  # 0.494%
    "ae":               0.0132,   # 1.32%
    "impot_federal":    0.15,     # 15% simplifie
    "impot_provincial": 0.15,     # 15% simplifie
}

TAUX_CHARGES_EMPLOYEUR = {
    "rrq":    0.064,
    "rqap":   0.00692,
    "ae":     0.01848,
    "cnesst": 0.018,   # Commission sante securite travail (variable par classe risque)
    "fss":    0.0165,  # Fonds services de sante
    "ccq":    0.125,   # Secteur construction (seulement si applicable)
}


# ============================================
# LISTS OF CALCULATORS (frontend metadata)
# ============================================

CALCULATEURS_LISTE = [
    {"id": "concrete",                    "category": "structure",  "name": "Beton",                 "icon": "Building2",    "description": "Volume, dosage CSA A23.1, armature, cure, excavation"},
    {"id": "stairs",                      "category": "structure",  "name": "Escaliers",             "icon": "Layers",       "description": "Dimensions CCQ 9.8, Blondel, materiaux, garde-corps"},
    {"id": "charge-tributaire-complete",  "category": "structure",  "name": "Analyse structurale",   "icon": "Ruler",        "description": "Poutre/linteau CNBC/CSA O86"},
    {"id": "roofing",                     "category": "enveloppe",  "name": "Toiture",               "icon": "Building2",    "description": "Surface, bardeaux, ventilation, solins, gouttieres"},
    {"id": "painting",                    "category": "enveloppe",  "name": "Peinture",              "icon": "Paintbrush",   "description": "Surface, DFT, point de rosee, dilution"},
    {"id": "electrical",                  "category": "mecanique",  "name": "Electricite",           "icon": "Zap",          "description": "Calibrage cable CCE, charge residentielle, eclairage"},
    {"id": "plumbing",                    "category": "mecanique",  "name": "Plomberie",             "icon": "Droplets",     "description": "DFU, WSFU, Hazen-Williams, chauffe-eau"},
    {"id": "hvac",                        "category": "mecanique",  "name": "CVAC",                  "icon": "Wind",         "description": "Charge thermique ASHRAE, conduits, CFM, HRV/ERV"},
    {"id": "welding",                     "category": "metal",      "name": "Soudure",               "icon": "Flame",        "description": "Parametres CSA W47.1, heat input, prechauffage"},
    {"id": "bending",                     "category": "metal",      "name": "Pliage metal",          "icon": "Wrench",       "description": "Developpement, tonnage, springback, rayon min"},
    {"id": "metal-weight",                "category": "metal",      "name": "Poids metal",           "icon": "Weight",       "description": "Poids par forme + 20 materiaux + profiles W/C"},
    {"id": "taxes",                       "category": "finances",   "name": "Taxes Quebec",          "icon": "DollarSign",   "description": "TPS 5% + TVQ 9.975%"},
    {"id": "charge-tributaire",           "category": "finances",   "name": "Paie employe",          "icon": "DollarSign",   "description": "Deductions + charges employeur Quebec"},
]

CATEGORIES_CALCS = {
    "structure":  {"label": "Structure",  "color": "#3B82F6", "icon": "Building2"},
    "enveloppe":  {"label": "Enveloppe",  "color": "#10B981", "icon": "Home"},
    "mecanique":  {"label": "Mecanique",  "color": "#8B5CF6", "icon": "Wrench"},
    "metal":      {"label": "Metal",      "color": "#F59E0B", "icon": "Hammer"},
    "finances":   {"label": "Finances",   "color": "#14B8A6", "icon": "DollarSign"},
}


# ============================================
# CLAUDE OPUS 4.6 SYSTEM PROMPT
# ============================================

CALC_AI_SYSTEM_PROMPT = """Tu es un expert senior en construction au Quebec avec 25 ans d'experience sur les chantiers, specialise dans les calculs techniques pour tous les metiers: beton, escaliers, electricite, plomberie, CVAC, toiture, peinture, soudure, pliage metal, structures.

Tu maitrises parfaitement:
- Le Code de construction du Quebec (CCQ) et ses chapitres (Batiment, Plomberie, Electricite, etc.)
- Le Code national du batiment du Canada (CNBC)
- Les normes CSA: A23.1/A23.2/A23.3 (beton), O86 (bois), S16 (acier), W47.1/W59 (soudage), G30.18 (armature)
- Le Code canadien de l'electricite (CCE) et ses tables (ampacite, chute tension, grounding)
- Le Code national de plomberie (CNP): DFU, WSFU, ventilation, pente drain
- Les normes ASHRAE (90.1 efficacite, 62.2 ventilation residentielle)
- Les specifications AWS D1.1 (soudage structural)
- Les charges de neige provinciales (CNBC 4.1.6)
- Les pentes securitaires CNESST pour excavations
- Les taxes du Quebec: TPS 5%, TVQ 9.975%
- Les taux CCQ, CNESST, RRQ, RQAP, AE 2024

Tu reponds toujours en francais quebecois clair et professionnel.
Tu cites les articles de normes/lois pertinents quand approprie (ex: CCQ 9.8, CSA A23.1 Table X, CCE Article 8-200).
Si tu n'es pas 100% sur, indique-le clairement et recommande de consulter un professionnel (ingenieur, RBQ, CCQ).
N'invente JAMAIS de numeros d'articles ou de valeurs de tables. Prefere indiquer "a verifier" plutot que fabriquer une reference.
Pour les valeurs numeriques critiques (resistances, epaisseurs, ampacites), encadre-les et justifie-les.
"""

# Practical advice by calculator (shown in UI)
CONSEILS_CALCULATEURS = {
    "concrete": [
        "Prevoir 10% de perte pour volumes < 10 m3 (5% pour volumes plus grands).",
        "Utiliser classe C-2 (25 MPa, air 6%) pour tout element exterieur au Quebec.",
        "Enrobage minimum 75 mm pour contact avec sol humide.",
        "Cure minimum 7 jours entre 5-10 C, 10 jours entre 0-5 C.",
    ],
    "stairs": [
        "Formule de Blondel: 2R + G = 630 mm optimal (60-65 confort).",
        "Hauteur contremarche: 175 mm residentiel, 170 mm commercial (optimal).",
        "Palier obligatoire a chaque 12 contremarches successives.",
        "Main courante obligatoire CCQ 9.8.7.4 - hauteur 865-965 mm.",
    ],
    "electrical": [
        "Chute de tension max: 3% branche, 5% total (CCE 4-004).",
        "Augmenter le calibre de 1 cran AWG par 30 m de cable supplementaire.",
        "Utiliser cuivre pour residentiel, aluminium possible pour services > 100A.",
        "Mise a terre < 25 ohms exigee par Hydro-Quebec.",
    ],
    "roofing": [
        "Protection barrages glace CCQ 9.26.5.3: membrane auto-adhesive 90 cm min sur avant-toits.",
        "Ventilation combles: 1:300 avec pare-vapeur, 1:150 sans.",
        "Ventilation repartie 50/50 entre entree (soffite) et sortie (faite).",
        "Pente minimum bardeaux asphalte: 2:12 (sinon membrane).",
    ],
    "painting": [
        "Point de rosee: la temperature de surface doit etre +3 C au-dessus.",
        "Humidite relative max pour latex: 85%. Pour alkyde: 80%.",
        "Temperature application: 10-30 C pour latex, 5-30 C pour alkyde.",
        "2 couches minimum, 3 sur surfaces neuves ou tres absorbantes.",
    ],
    "plumbing": [
        "Pente minimum drainage: 1/4 po/pi (2%) pour diametres <= 3 po, 1/8 po/pi (1%) pour > 3 po.",
        "Vitesse max alimentation: 8 pi/s (evite bruits et coup de belier).",
        "Distance max soudure cuivre-galvanise: isoler avec dielectrique.",
        "Chauffe-eau: calculer First Hour Rating (FHR) > consommation pointe matin.",
    ],
    "hvac": [
        "Facteur securite 10% minimum sur charge thermique calculee.",
        "Ventilation ASHRAE 62.2: 0.03 CFM/pi2 + 7.5 CFM/(chambre + 1).",
        "Sectionner conduits horizontaux tous les 2.4 m (etriers).",
        "Thermopompe: efficacite chute sous -25 C, prevoir auxiliaire.",
    ],
    "welding": [
        "Prechauffer si CE > 0.45 ou epaisseur > 25 mm.",
        "Heat Input 1.5-3.0 kJ/mm pour acier doux, 1.0-1.5 pour inox.",
        "E7018 doit etre seche (oven 120 C) si exposee > 4 h a l'humidite.",
        "CSA W47.1 Division 1 exigee pour tout acier structural.",
    ],
    "bending": [
        "Rayon minimum = 0.5x epaisseur pour acier doux laminar a froid.",
        "Springback = 0.5 a 4 degres - toujours plier 1-2 plus pour compenser.",
        "Ouverture V = 8x epaisseur pour 3-6 mm (regle du pouce).",
        "Le grain de tolerie perpendiculaire au pli = moins de fissures.",
    ],
    "metal-weight": [
        "Densite acier standard: 7850 kg/m3 (0.2836 lb/po3).",
        "Prix 2024: acier A36 ~1.20 $/kg, inox 304 ~4.50 $/kg, alu 6061 ~5 $/kg.",
        "Prevoir 5-10% de perte au sciage, 10-15% au plasma.",
        "Profiles W: masse = chiffre apres le x (ex: W310x52 = 52 kg/m).",
    ],
}
