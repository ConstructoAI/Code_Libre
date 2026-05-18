"""
ERP React - Subventions Module — Static Data
Ported from Streamlit subventions_manager.py (sessions 15+).

Contains:
- Enums/constants (types d'aide, niveaux gouvernement, difficultes, statuts)
- DEFAULT_CATEGORIES (8 categories)
- DEFAULT_PROGRAMMES (40+ Quebec/Canada subsidy programs, 2025-2028)
- DEFAULT_ORGANISMES (8 partner organizations)
- PLAN_PME_2025_2028 (6 major programs, 219M$)
- AI_SYSTEM_PROMPT (Claude Opus 4.6 expert prompt)
"""

# ============================================
# ENUMS / CONSTANTS
# ============================================

TYPES_AIDE = {
    "SUBVENTION": {"label": "Subvention", "color": "#10B981"},
    "PRET": {"label": "Pret", "color": "#3B82F6"},
    "CREDIT_IMPOT": {"label": "Credit d'impot", "color": "#8B5CF6"},
    "MIXTE": {"label": "Mixte", "color": "#F59E0B"},
    "GARANTIE": {"label": "Garantie de pret", "color": "#6366F1"},
}

NIVEAUX_GOUVERNEMENT = {
    "FEDERAL": {"label": "Federal", "color": "#EF4444"},
    "PROVINCIAL": {"label": "Provincial", "color": "#3B82F6"},
    "MUNICIPAL": {"label": "Municipal", "color": "#10B981"},
    "MIXTE": {"label": "Mixte", "color": "#8B5CF6"},
}

NIVEAUX_DIFFICULTE = {
    "FACILE": {"label": "Facile", "color": "#10B981"},
    "MOYEN": {"label": "Moyen", "color": "#F59E0B"},
    "COMPLEXE": {"label": "Complexe", "color": "#EF4444"},
}

STATUTS_DEMANDE = {
    "BROUILLON": {"label": "Brouillon", "color": "#9CA3AF"},
    "EN_PREPARATION": {"label": "En preparation", "color": "#F59E0B"},
    "SOUMISE": {"label": "Soumise", "color": "#3B82F6"},
    "EN_EVALUATION": {"label": "En evaluation", "color": "#8B5CF6"},
    "INFO_SUPPLEMENTAIRE": {"label": "Info requise", "color": "#F97316"},
    "APPROUVEE": {"label": "Approuvee", "color": "#10B981"},
    "REFUSEE": {"label": "Refusee", "color": "#EF4444"},
    "ANNULEE": {"label": "Annulee", "color": "#1F2937"},
    "VERSEE": {"label": "Versee", "color": "#059669"},
}

STATUTS_DOCUMENT = {
    "A_FOURNIR": {"label": "A fournir", "color": "#9CA3AF"},
    "FOURNI": {"label": "Fourni", "color": "#3B82F6"},
    "VALIDE": {"label": "Valide", "color": "#10B981"},
    "REJETE": {"label": "Rejete", "color": "#EF4444"},
}

SECTEURS_ACTIVITE = [
    "PME", "CONSTRUCTION", "RENOVATION", "MANUFACTURIER", "ENERGIE",
    "LOGEMENT", "COMMERCIAL", "RESIDENTIEL", "NUMERIQUE", "FORMATION",
    "EMPLOYEUR", "EXPORTATEUR", "STARTUP", "DEMARRAGE", "REPRENEURIAT",
    "RURAL", "FAIBLE_REVENU", "PATRIMOINE", "BOIS",
]

REGIONS_QUEBEC = [
    "Bas-Saint-Laurent", "Saguenay-Lac-Saint-Jean", "Capitale-Nationale",
    "Mauricie", "Estrie", "Montreal", "Outaouais", "Abitibi-Temiscamingue",
    "Cote-Nord", "Nord-du-Quebec", "Gaspesie-Iles-de-la-Madeleine",
    "Chaudiere-Appalaches", "Laval", "Lanaudiere", "Laurentides",
    "Monteregie", "Centre-du-Quebec", "Autre",
]

TAILLES_ENTREPRISE = [
    "Travailleur autonome",
    "Micro (1-4 employes)",
    "Petite (5-49 employes)",
    "Moyenne (50-199 employes)",
    "Grande (200+ employes)",
]

TYPES_PROJET = [
    "Demarrage", "Expansion", "Modernisation", "Transformation numerique",
    "Efficacite energetique", "Formation", "Exportation", "Repreneuriat",
    "Renovation", "Equipement", "R&D", "Embauche", "Energie verte",
]

NIVEAUX_URGENCE = [
    "Immediat (< 3 mois)",
    "Court terme (3-6 mois)",
    "Moyen terme (6-12 mois)",
    "Long terme (> 12 mois)",
]


# ============================================
# DEFAULT CATEGORIES (8)
# ============================================

DEFAULT_CATEGORIES = [
    {"code": "PME_GENERAL", "nom": "PME & Entreprises",
     "description": "Programmes generaux pour PME", "ordre_affichage": 1},
    {"code": "CONSTRUCTION", "nom": "Construction & Renovation",
     "description": "Programmes pour le secteur construction", "ordre_affichage": 2},
    {"code": "ENERGIE", "nom": "Energie & Environnement",
     "description": "Efficacite energetique et developpement durable", "ordre_affichage": 3},
    {"code": "FORMATION", "nom": "Formation & Emploi",
     "description": "Formation et developpement des competences", "ordre_affichage": 4},
    {"code": "INNOVATION", "nom": "Innovation & Technologie",
     "description": "R&D et transformation numerique", "ordre_affichage": 5},
    {"code": "REGIONAL", "nom": "Developpement Regional",
     "description": "Programmes regionaux et municipaux", "ordre_affichage": 6},
    {"code": "DEMARRAGE", "nom": "Demarrage & Repreneuriat",
     "description": "Creation et reprise d'entreprises", "ordre_affichage": 7},
    {"code": "EXPORT", "nom": "Exportation",
     "description": "Programmes pour l'exportation", "ordre_affichage": 8},
]


# ============================================
# DEFAULT PROGRAMMES (40+)
# ============================================

DEFAULT_PROGRAMMES = [
    # ===== PME_GENERAL =====
    {
        "code": "ESSOR_V1", "categorie_code": "PME_GENERAL",
        "nom": "ESSOR - Volet 1 Etudes", "organisme": "Investissement Quebec",
        "description": "Etudes de faisabilite et diagnostic numerique. Jusqu'a 50% des depenses admissibles.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 100000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PME", "CONSTRUCTION", "MANUFACTURIER"],
        "telephone": "1 844 474-6367", "url_programme": "https://www.investquebec.com",
        "difficulte": "MOYEN", "date_debut": "2025-04-01", "date_fin": "2027-03-31",
    },
    {
        "code": "ESSOR_V2", "categorie_code": "PME_GENERAL",
        "nom": "ESSOR - Volet 2 Productivite", "organisme": "Investissement Quebec",
        "description": "Productivite et expansion. Prets et contributions pour projets de croissance.",
        "type_aide": "MIXTE", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 5000000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PME", "CONSTRUCTION", "MANUFACTURIER"],
        "telephone": "1 844 474-6367", "url_programme": "https://www.investquebec.com",
        "difficulte": "COMPLEXE", "date_debut": "2025-04-01", "date_fin": "2027-03-31",
    },
    {
        "code": "ESSOR_V3", "categorie_code": "PME_GENERAL",
        "nom": "ESSOR - Volet 3 Environnement", "organisme": "Investissement Quebec",
        "description": "Reduction de l'empreinte environnementale des entreprises.",
        "type_aide": "MIXTE", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 2000000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PME", "CONSTRUCTION", "MANUFACTURIER"],
        "telephone": "1 844 474-6367", "url_programme": "https://www.investquebec.com",
        "difficulte": "MOYEN", "date_debut": "2025-04-01", "date_fin": "2027-03-31",
    },
    {
        "code": "ESSOR_V4", "categorie_code": "PME_GENERAL",
        "nom": "ESSOR - Volet 4 International", "organisme": "Investissement Quebec",
        "description": "Internationalisation et developpement des marches exterieurs.",
        "type_aide": "MIXTE", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 1000000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PME", "EXPORTATEUR"],
        "telephone": "1 844 474-6367", "url_programme": "https://www.investquebec.com",
        "difficulte": "MOYEN", "date_debut": "2025-04-01", "date_fin": "2027-03-31",
    },
    {
        "code": "FLI", "categorie_code": "PME_GENERAL",
        "nom": "Fonds locaux d'investissement", "organisme": "MRC locales",
        "description": "Financement pour demarrage, croissance, transformation et releve entrepreneuriale.",
        "type_aide": "PRET", "niveau_gouvernement": "MUNICIPAL",
        "montant_min": 5000, "montant_max": 500000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["PME", "STARTUP", "CONSTRUCTION"],
        "difficulte": "FACILE",
    },
    {
        "code": "BDC_PME", "categorie_code": "PME_GENERAL",
        "nom": "Financement PME BDC", "organisme": "Banque de developpement du Canada",
        "description": "Prets a terme pour entreprises en croissance. Financement flexible et conseils experts.",
        "type_aide": "PRET", "niveau_gouvernement": "FEDERAL",
        "montant_min": 10000, "montant_max": 5000000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["PME", "CONSTRUCTION", "MANUFACTURIER"],
        "url_programme": "https://www.bdc.ca", "difficulte": "MOYEN",
    },

    # ===== CONSTRUCTION =====
    {
        "code": "SCHL_CONSTRUCTION", "categorie_code": "CONSTRUCTION",
        "nom": "Fonds logement abordable - Construction", "organisme": "SCHL",
        "description": "Prets a faible taux pour construction de logements abordables. Jusqu'a 95% des couts, amortissement 50 ans.",
        "type_aide": "PRET", "niveau_gouvernement": "FEDERAL",
        "montant_min": 0, "montant_max": 50000000, "pourcentage_aide": 95,
        "secteurs_admissibles": ["CONSTRUCTION", "LOGEMENT"],
        "url_programme": "https://www.cmhc-schl.gc.ca", "difficulte": "COMPLEXE",
    },
    {
        "code": "SCHL_RENOVATION", "categorie_code": "CONSTRUCTION",
        "nom": "Fonds logement abordable - Renovation", "organisme": "SCHL",
        "description": "Prets et contributions pour renover des logements abordables existants.",
        "type_aide": "MIXTE", "niveau_gouvernement": "FEDERAL",
        "montant_min": 0, "montant_max": 10000000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["CONSTRUCTION", "RENOVATION", "LOGEMENT"],
        "url_programme": "https://www.cmhc-schl.gc.ca", "difficulte": "MOYEN",
    },
    {
        "code": "SCHL_ECOENERGETIQUE", "categorie_code": "CONSTRUCTION",
        "nom": "Programme renovation ecoenergetique", "organisme": "SCHL",
        "description": "Renovations majeures ecoenergetiques dans immeubles collectifs. Jusqu'a 170 000$ par logement.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "FEDERAL",
        "montant_min": 0, "montant_max": 170000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["CONSTRUCTION", "RENOVATION", "ENERGIE"],
        "url_programme": "https://www.cmhc-schl.gc.ca", "difficulte": "MOYEN",
    },
    {
        "code": "NOVOCLIMAT", "categorie_code": "CONSTRUCTION",
        "nom": "Certification Novoclimat", "organisme": "Transition Energetique Quebec",
        "description": "Prime de 25% sur assurance pret SCHL pour habitations ecoenergetiques certifiees.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 0, "pourcentage_aide": 25,
        "secteurs_admissibles": ["CONSTRUCTION", "ENERGIE"],
        "url_programme": "https://transitionenergetique.gouv.qc.ca", "difficulte": "MOYEN",
    },
    {
        "code": "MAISONS_CANADA", "categorie_code": "CONSTRUCTION",
        "nom": "Programme Maisons Canada", "organisme": "Gouvernement du Canada",
        "description": "Financement aux constructeurs utilisant bois d'oeuvre et materiaux canadiens. Objectif 500 000 maisons/an.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "FEDERAL",
        "montant_min": 0, "montant_max": 10000000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["CONSTRUCTION", "LOGEMENT"],
        "url_programme": "https://www.canada.ca", "difficulte": "COMPLEXE",
        "date_debut": "2025-08-05",
    },
    {
        "code": "RENOVERT", "categorie_code": "CONSTRUCTION",
        "nom": "Credit d'impot RenoVert", "organisme": "Revenu Quebec",
        "description": "Credit d'impot remboursable pour travaux de renovation ecoresponsable.",
        "type_aide": "CREDIT_IMPOT", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 10000, "pourcentage_aide": 20,
        "secteurs_admissibles": ["RENOVATION", "RESIDENTIEL", "ENERGIE"],
        "url_programme": "https://www.revenuquebec.ca", "difficulte": "FACILE",
    },

    # ===== ENERGIE =====
    {
        "code": "LOGIVERT", "categorie_code": "ENERGIE",
        "nom": "Programme LogisVert", "organisme": "Hydro-Quebec",
        "description": "Thermopompe jusqu'a 6 700$ (22 000$ avec accumulateur). Bonus 5% si plusieurs mesures.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 22000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["RENOVATION", "ENERGIE", "RESIDENTIEL"],
        "url_programme": "https://www.hydroquebec.com/logivert", "difficulte": "FACILE",
    },
    {
        "code": "RENOCLIMAT", "categorie_code": "ENERGIE",
        "nom": "Programme Renoclimat", "organisme": "Transition Energetique Quebec",
        "description": "Isolation murs/toitures/planchers, fenetres, chauffage performant. Evaluation energetique gratuite.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 20000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["RENOVATION", "ENERGIE", "RESIDENTIEL"],
        "url_programme": "https://transitionenergetique.gouv.qc.ca", "difficulte": "FACILE",
    },
    {
        "code": "PRET_VERT", "categorie_code": "ENERGIE",
        "nom": "Pret canadien maisons plus vertes", "organisme": "Gouvernement du Canada",
        "description": "Pret sans interet jusqu'a 40 000$ pour renovations recommandees par evaluation energetique.",
        "type_aide": "PRET", "niveau_gouvernement": "FEDERAL",
        "montant_min": 0, "montant_max": 40000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["RENOVATION", "ENERGIE", "RESIDENTIEL"],
        "url_programme": "https://www.canada.ca", "difficulte": "FACILE",
    },
    {
        "code": "INITIATIVE_VERTE", "categorie_code": "ENERGIE",
        "nom": "Initiative maisons plus vertes", "organisme": "Gouvernement du Canada",
        "description": "Subventions jusqu'a 5 000$ par menage pour isolation, fenetres et chauffage ecologique.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "FEDERAL",
        "montant_min": 0, "montant_max": 5000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["RENOVATION", "ENERGIE", "RESIDENTIEL"],
        "url_programme": "https://www.canada.ca", "difficulte": "FACILE",
    },
    {
        "code": "CHAUFFEZ_VERT", "categorie_code": "ENERGIE",
        "nom": "Programme Chauffez Vert", "organisme": "Transition Energetique Quebec",
        "description": "Remplacement systemes au mazout ou propane par thermopompes ou systemes electriques.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 15000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["RENOVATION", "ENERGIE"],
        "url_programme": "https://transitionenergetique.gouv.qc.ca", "difficulte": "FACILE",
    },
    {
        "code": "ECOPERFORMANCE", "categorie_code": "ENERGIE",
        "nom": "EcoPerformance", "organisme": "Transition Energetique Quebec",
        "description": "Aide financiere aux entreprises pour reduire leur consommation energetique.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 5000, "montant_max": 100000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PME", "MANUFACTURIER", "ENERGIE"],
        "url_programme": "https://transitionenergetique.gouv.qc.ca", "difficulte": "MOYEN",
    },
    {
        "code": "TECHNOCLIMAT", "categorie_code": "ENERGIE",
        "nom": "Technoclimat", "organisme": "Transition Energetique Quebec",
        "description": "Demonstration de technologies innovantes en efficacite energetique.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 50000, "montant_max": 5000000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["MANUFACTURIER", "ENERGIE", "CONSTRUCTION"],
        "url_programme": "https://transitionenergetique.gouv.qc.ca", "difficulte": "COMPLEXE",
    },
    {
        "code": "RENOREGION", "categorie_code": "ENERGIE",
        "nom": "Programme RenoRegion", "organisme": "SHQ",
        "description": "Pour proprietaires a faible revenu en milieu rural. Toiture, infiltrations, problemes structuraux.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 25000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["RENOVATION", "RURAL"],
        "difficulte": "MOYEN",
    },
    {
        "code": "ECONOLOGIS", "categorie_code": "ENERGIE",
        "nom": "Programme Econologis", "organisme": "Transition Energetique Quebec",
        "description": "Services gratuits pour menages a revenu modeste: conseils, travaux legers, thermostats.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 0, "pourcentage_aide": 100,
        "secteurs_admissibles": ["ENERGIE", "FAIBLE_REVENU"],
        "url_programme": "https://transitionenergetique.gouv.qc.ca", "difficulte": "FACILE",
    },

    # ===== FORMATION =====
    {
        "code": "PACME", "categorie_code": "FORMATION",
        "nom": "PACME - Formation PME", "organisme": "Emploi-Quebec",
        "description": "Aide financiere pour formation des employes et developpement des competences.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 100000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PME", "EMPLOYEUR", "FORMATION"],
        "url_programme": "https://www.quebec.ca", "difficulte": "MOYEN",
    },
    {
        "code": "CREDIT_APPRENTI", "categorie_code": "FORMATION",
        "nom": "Credit d'impot pour apprenti", "organisme": "Gouvernement du Canada",
        "description": "Jusqu'a 2 000$ par annee par apprenti dans un metier Sceau Rouge avec contrat enregistre.",
        "type_aide": "CREDIT_IMPOT", "niveau_gouvernement": "FEDERAL",
        "montant_min": 0, "montant_max": 2000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["EMPLOYEUR", "FORMATION"],
        "url_programme": "https://www.canada.ca", "difficulte": "FACILE",
    },
    {
        "code": "CREDIT_STAGE", "categorie_code": "FORMATION",
        "nom": "Credit d'impot stage en milieu de travail", "organisme": "Revenu Quebec",
        "description": "Pour apprentis inscrits au Programme d'apprentissage en milieu de travail.",
        "type_aide": "CREDIT_IMPOT", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 0, "pourcentage_aide": 30,
        "secteurs_admissibles": ["EMPLOYEUR", "FORMATION"],
        "url_programme": "https://www.revenuquebec.ca", "difficulte": "MOYEN",
    },
    {
        "code": "CREDIT_FORMATION", "categorie_code": "FORMATION",
        "nom": "Credit d'impot formation PME", "organisme": "Revenu Quebec",
        "description": "Jusqu'a 5 460$ par employe par annee. Masse salariale moins de 5M$ requise.",
        "type_aide": "CREDIT_IMPOT", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 5460, "pourcentage_aide": 0,
        "secteurs_admissibles": ["PME", "EMPLOYEUR", "FORMATION"],
        "url_programme": "https://www.revenuquebec.ca", "difficulte": "MOYEN",
    },
    {
        "code": "MFOR", "categorie_code": "FORMATION",
        "nom": "Mesure de formation main-d'oeuvre", "organisme": "Services Quebec",
        "description": "Soutien a la formation en emploi pour augmenter la productivite.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 100000, "pourcentage_aide": 75,
        "secteurs_admissibles": ["PME", "FORMATION"],
        "url_programme": "https://www.quebec.ca", "difficulte": "MOYEN",
    },
    {
        "code": "SUBV_SALARIALE", "categorie_code": "FORMATION",
        "nom": "Subvention salariale", "organisme": "Emploi-Quebec",
        "description": "Soutien financier a l'embauche et a l'integration en emploi.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 50000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["EMPLOYEUR"],
        "url_programme": "https://www.quebec.ca", "difficulte": "MOYEN",
    },

    # ===== INNOVATION =====
    {
        "code": "CNRC_PARI", "categorie_code": "INNOVATION",
        "nom": "Programme Innovation PARI-CNRC", "organisme": "CNRC-PARI",
        "description": "Financement et conseils techniques pour projets d'innovation et de R&D en PME.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "FEDERAL",
        "montant_min": 10000, "montant_max": 500000, "pourcentage_aide": 80,
        "secteurs_admissibles": ["PME", "NUMERIQUE", "MANUFACTURIER"],
        "url_programme": "https://nrc.canada.ca", "difficulte": "MOYEN",
    },
    {
        "code": "RSDE", "categorie_code": "INNOVATION",
        "nom": "RS&DE - Recherche scientifique et developpement experimental",
        "organisme": "Agence du revenu du Canada",
        "description": "Credit d'impot federal pour depenses de R&D. 35% pour PME sur premiers 3M$.",
        "type_aide": "CREDIT_IMPOT", "niveau_gouvernement": "FEDERAL",
        "montant_min": 0, "montant_max": 3000000, "pourcentage_aide": 35,
        "secteurs_admissibles": ["PME", "MANUFACTURIER", "NUMERIQUE"],
        "url_programme": "https://www.canada.ca/fr/agence-revenu", "difficulte": "COMPLEXE",
    },
    {
        "code": "PCAN_V1", "categorie_code": "INNOVATION",
        "nom": "PCAN - Croitre en ligne", "organisme": "Gouvernement du Canada",
        "description": "Micro-subventions de 2 400$ pour developper la presence en ligne.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "FEDERAL",
        "montant_min": 2400, "montant_max": 2400, "pourcentage_aide": 0,
        "secteurs_admissibles": ["PME", "NUMERIQUE"],
        "url_programme": "https://www.canada.ca", "difficulte": "FACILE",
    },
    {
        "code": "PCAN_V2", "categorie_code": "INNOVATION",
        "nom": "PCAN - Adoption technologique", "organisme": "Gouvernement du Canada",
        "description": "Jusqu'a 15 000$ en subvention + pret a 0% pour accelerer l'adoption numerique.",
        "type_aide": "MIXTE", "niveau_gouvernement": "FEDERAL",
        "montant_min": 0, "montant_max": 15000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["PME", "NUMERIQUE"],
        "url_programme": "https://www.canada.ca", "difficulte": "MOYEN",
    },
    {
        "code": "ESSOR_NUMERIQUE", "categorie_code": "INNOVATION",
        "nom": "ESSOR - Volet numerique", "organisme": "Investissement Quebec",
        "description": "Jusqu'a 50 000$ pour systemes numeriques, ERP, commerce electronique.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 50000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PME", "NUMERIQUE"],
        "telephone": "1 844 474-6367", "url_programme": "https://www.investquebec.com",
        "difficulte": "MOYEN",
    },
    {
        "code": "OTN", "categorie_code": "INNOVATION",
        "nom": "Offensive transformation numerique", "organisme": "MEI",
        "description": "Accompagnement specialise pour accroitre competitivite via le numerique.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 100000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PME", "NUMERIQUE"],
        "url_programme": "https://www.economie.gouv.qc.ca", "difficulte": "MOYEN",
    },

    # ===== REGIONAL =====
    {
        "code": "SADC_FEDERAL", "categorie_code": "REGIONAL",
        "nom": "SADC - Developpement economique regional", "organisme": "DEC Canada",
        "description": "Prets, conseils et soutien aux entreprises des regions rurales du Quebec.",
        "type_aide": "MIXTE", "niveau_gouvernement": "FEDERAL",
        "montant_min": 5000, "montant_max": 250000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["PME", "RURAL", "CONSTRUCTION"],
        "url_programme": "https://www.dec-ced.gc.ca", "difficulte": "MOYEN",
    },
    {
        "code": "FACADES_COMMERCIALES", "categorie_code": "REGIONAL",
        "nom": "Renovation facades commerciales", "organisme": "Municipalites",
        "description": "50% des couts admissibles, max 50 000$ par immeuble. +10 000$ patrimoine, +6 000$ accessibilite.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "MUNICIPAL",
        "montant_min": 0, "montant_max": 66000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["COMMERCIAL", "RENOVATION"],
        "difficulte": "FACILE",
    },
    {
        "code": "PATRIMOINE", "categorie_code": "REGIONAL",
        "nom": "Restauration batiments patrimoniaux", "organisme": "Municipalites",
        "description": "Restauration et revitalisation de batiments patrimoniaux dans arrondissements historiques.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "MUNICIPAL",
        "montant_min": 0, "montant_max": 100000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PATRIMOINE", "RENOVATION"],
        "difficulte": "MOYEN",
    },
    {
        "code": "ANTIREFOULEMENT", "categorie_code": "REGIONAL",
        "nom": "Dispositifs antirefoulement", "organisme": "Ville de Quebec",
        "description": "Installation de dispositifs antirefoulement pour prevenir les inondations.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "MUNICIPAL",
        "montant_min": 0, "montant_max": 5000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["RESIDENTIEL", "RENOVATION"],
        "url_programme": "https://www.ville.quebec.qc.ca", "difficulte": "FACILE",
    },

    # ===== DEMARRAGE =====
    {
        "code": "MICROENTREPRENDRE", "categorie_code": "DEMARRAGE",
        "nom": "MicroEntreprendre", "organisme": "MicroEntreprendre",
        "description": "Microcredit jusqu'a 20 000$ pour demarrage d'entreprise.",
        "type_aide": "PRET", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 500, "montant_max": 20000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["STARTUP", "DEMARRAGE"],
        "url_programme": "https://microentreprendre.ca", "difficulte": "FACILE",
    },
    {
        "code": "RELEVE_ENTREPRISE", "categorie_code": "DEMARRAGE",
        "nom": "Programme Releve entreprise", "organisme": "MEI",
        "description": "Aide financiere complementaire pour le transfert d'entreprises. Enveloppe de 3M$.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 100000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["REPRENEURIAT"],
        "url_programme": "https://www.economie.gouv.qc.ca", "difficulte": "MOYEN",
    },
    {
        "code": "REPRENEURIAT_QC", "categorie_code": "DEMARRAGE",
        "nom": "Repreneuriat Quebec", "organisme": "MEI",
        "description": "Services bonifies pour accompagnement au transfert d'entreprises.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 50000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["REPRENEURIAT"],
        "url_programme": "https://www.economie.gouv.qc.ca", "difficulte": "FACILE",
    },
    {
        "code": "CAMPUS_REPRENEURIAT", "categorie_code": "DEMARRAGE",
        "nom": "Campus du repreneuriat", "organisme": "MEI",
        "description": "Nouveau programme de formation pour repreneurs. Enveloppe de 637 000$.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 25000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["REPRENEURIAT", "FORMATION"],
        "url_programme": "https://www.economie.gouv.qc.ca", "difficulte": "FACILE",
    },

    # ===== EXPORT =====
    {
        "code": "CANEXPORT", "categorie_code": "EXPORT",
        "nom": "CanExport PME", "organisme": "Gouvernement du Canada",
        "description": "Jusqu'a 75 000$ pour couvrir 50% des couts d'activites de developpement de marches etrangers.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "FEDERAL",
        "montant_min": 10000, "montant_max": 75000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PME", "EXPORTATEUR"],
        "url_programme": "https://www.tradecommissioner.gc.ca", "difficulte": "MOYEN",
    },
    {
        "code": "EXPORT_QUEBEC", "categorie_code": "EXPORT",
        "nom": "Export Quebec", "organisme": "Investissement Quebec",
        "description": "Accompagnement et financement pour les entreprises qui souhaitent exporter.",
        "type_aide": "MIXTE", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 5000, "montant_max": 100000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PME", "EXPORTATEUR"],
        "telephone": "1 844 474-6367", "url_programme": "https://www.investquebec.com",
        "difficulte": "MOYEN",
    },
    {
        "code": "FRONTIERE", "categorie_code": "EXPORT",
        "nom": "Programme Frontiere", "organisme": "Investissement Quebec",
        "description": "Aide financiere rapide pour besoins de liquidites lies aux tarifs douaniers. Jusqu'a 50M$ par entreprise.",
        "type_aide": "PRET", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 50000000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["PME", "EXPORTATEUR"],
        "telephone": "1 844 474-6367", "url_programme": "https://www.investquebec.com",
        "difficulte": "COMPLEXE",
    },
    {
        "code": "CHANTIER_PRODUCTIVITE", "categorie_code": "EXPORT",
        "nom": "Chantier productivite", "organisme": "Investissement Quebec",
        "description": "Pret sans interet + contributions pour amelioration de la productivite.",
        "type_aide": "MIXTE", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 5000000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["PME", "MANUFACTURIER"],
        "telephone": "1 844 474-6367", "url_programme": "https://www.investquebec.com",
        "difficulte": "MOYEN",
    },
    {
        "code": "IRRT", "categorie_code": "EXPORT",
        "nom": "Programme IRRT", "organisme": "MEI",
        "description": "Innovation, Resilience et Reorganisation Technologique pour PME manufacturieres touchees par droits de douane.",
        "type_aide": "SUBVENTION", "niveau_gouvernement": "PROVINCIAL",
        "montant_min": 0, "montant_max": 500000, "pourcentage_aide": 50,
        "secteurs_admissibles": ["PME", "MANUFACTURIER"],
        "url_programme": "https://www.economie.gouv.qc.ca", "difficulte": "COMPLEXE",
        "date_debut": "2025-10-10", "date_fin": "2025-10-31",
    },
    {
        "code": "BDC_BOIS", "categorie_code": "EXPORT",
        "nom": "BDC - Bois d'oeuvre", "organisme": "BDC",
        "description": "Prets a terme et lettres de credit. 700M$ disponibles pour industrie du bois.",
        "type_aide": "PRET", "niveau_gouvernement": "FEDERAL",
        "montant_min": 0, "montant_max": 10000000, "pourcentage_aide": 0,
        "secteurs_admissibles": ["BOIS", "CONSTRUCTION"],
        "url_programme": "https://www.bdc.ca", "difficulte": "MOYEN",
    },
]


# ============================================
# PARTNER ORGANIZATIONS (8)
# ============================================

DEFAULT_ORGANISMES = [
    {
        "nom": "Reseau Acces PME",
        "role": "500+ professionnels pour accompagnement",
        "contact": "Via votre MRC",
        "url": None,
    },
    {
        "nom": "Investissement Quebec",
        "role": "Administration programmes ESSOR et autres",
        "contact": "1 844 474-6367",
        "url": "https://www.investquebec.com",
    },
    {
        "nom": "SADC",
        "role": "Societes d'aide au developpement des collectivites",
        "contact": "Variable selon region",
        "url": "https://www.reseau-sadc.qc.ca",
    },
    {
        "nom": "APCHQ",
        "role": "Association des professionnels de la construction",
        "contact": None,
        "url": "https://www.apchq.com",
    },
    {
        "nom": "MicroEntreprendre",
        "role": "Microcredit aux entrepreneurs",
        "contact": None,
        "url": "https://microentreprendre.ca",
    },
    {
        "nom": "Annuaire des subventions",
        "role": "2 696 programmes de soutien financier",
        "contact": None,
        "url": "https://subventionsquebec.net",
    },
    {
        "nom": "Gouvernement du Canada",
        "role": "Outil de recherche d'aide aux entreprises",
        "contact": None,
        "url": "https://www.canada.ca/fr/services/entreprises/subventions.html",
    },
    {
        "nom": "Gouvernement du Quebec",
        "role": "Aide financiere aux entreprises",
        "contact": None,
        "url": "https://www.quebec.ca/entreprises-et-travailleurs-autonomes/aide-financiere",
    },
]


# ============================================
# PLAN PME 2025-2028 (219 M$)
# ============================================

PLAN_PME_2025_2028 = {
    "titre": "Plan PME 2025-2028",
    "montant_total": "219 M$",
    "description": (
        "Le gouvernement du Quebec consacre 219 millions de dollars pour stimuler la "
        "croissance, la competitivite et la productivite des PME."
    ),
    "programmes": [
        {"programme": "ESSOR", "enveloppe": "136 M$",
         "description": "Reconduction du programme"},
        {"programme": "Reseau acces PME", "enveloppe": "22,6 M$",
         "description": "450 conseillers en developpement economique"},
        {"programme": "MicroEntreprendre", "enveloppe": "12,7 M$",
         "description": "Services de microcredit"},
        {"programme": "Espaces PME innovation", "enveloppe": "14,4 M$",
         "description": "Accompagnement projets novateurs"},
        {"programme": "Groupes sous-representes", "enveloppe": "14,88 M$",
         "description": "Formation et accompagnement"},
        {"programme": "Repreneuriat", "enveloppe": "17 M$",
         "description": "Transfert d'entreprises"},
    ],
}


CONSEILS_PRATIQUES = [
    {
        "titre": "Etapes recommandees",
        "items": [
            "Commencez par votre MRC - point d'entree officiel",
            "Cumulez les programmes - maximum 80% des depenses admissibles",
            "Preparez votre dossier: etats financiers, plan d'affaires, projections",
            "Respectez les delais - soumettez bien avant la date limite",
            "Consultez un expert - conseillers MRC gratuits",
        ],
    },
    {
        "titre": "Points importants",
        "items": [
            "Cumul maximum: 80% des depenses admissibles",
            "2024-2025: 95% de l'aide directe d'Investissement Quebec va aux PME",
            "Le Quebec compte environ 230 000 PME (99,7% du tissu industriel)",
            "Les programmes changent frequemment - verifier les sites officiels",
        ],
    },
]


# ============================================
# AI SYSTEM PROMPT (Claude Opus 4.6)
# ============================================

AI_SYSTEM_PROMPT = """Tu es un expert-conseil specialise en programmes de subventions et d'aide financiere pour entreprises au Quebec et au Canada.

Tu possedes une expertise approfondie sur:

PROGRAMMES D'AIDE FINANCIERE:
- Subventions gouvernementales (federal, provincial, municipal)
- Prets a taux avantageux et garanties de pret
- Credits d'impot (RS&DE, CDAE, credit formation, etc.)
- Programmes sectoriels (construction, energie, numerique, export)

ORGANISMES QUEBECOIS:
- Investissement Quebec (IQ) - Programme ESSOR, Implantation, etc.
- Banque de developpement du Canada (BDC)
- SADC et CAE (developpement economique regional)
- Ministere de l'Economie et de l'Innovation
- Emploi-Quebec (formation main-d'oeuvre)
- Reseau Acces PME

SECTEUR CONSTRUCTION:
- Renovations ecoenergetiques (Renoclimat, LogiRenov)
- Programme Novoclimat (maisons neuves efficaces)
- Chauffez Vert (conversion energetique)
- Subventions patrimoine bati
- Programmes residentiels et commerciaux

PROCESSUS DE DEMANDE:
- Criteres d'eligibilite typiques
- Documents requis
- Etapes de soumission
- Delais de traitement
- Conseils pour maximiser les chances d'approbation

TON ROLE:
1. Identifier les programmes pertinents selon le profil de l'entreprise
2. Expliquer les criteres d'eligibilite de maniere claire
3. Guider dans la preparation des demandes
4. Suggerer des strategies pour maximiser le financement
5. Alerter sur les dates limites et programmes expires

IMPORTANT:
- Les programmes changent frequemment - toujours verifier sur les sites officiels
- Les montants et conditions sont indicatifs
- Recommander de consulter un comptable pour les credits d'impot complexes

Reponds toujours en francais quebecois, de maniere professionnelle et pratique."""
