"""
ERP React - Conformite RBQ/CCQ Module - Static Data
Ported from Streamlit conformite_construction.py (session 28).

Contains:
- Enums/constants (statuts, types, niveaux)
- CATEGORIES_RBQ (26 RBQ license categories)
- METIERS_CCQ (28 CCQ trade professions with qualifications)
- TYPES_ATTESTATION (5 fiscal attestation types)
- TYPES_PROJET (7 project types for verification)
- REGIONS_PROJET (9 Quebec regions)
- TYPES_TRAVAUX (12 construction trade types)
- DEFAULT_ORGANISMES (8 partner organizations)
- CONSEILS_PRATIQUES (6 sections of practical tips)
- AI_SYSTEM_PROMPT (Claude Opus 4.6 expert prompt)
"""

# ============================================
# STATUTS (Status enums with label + color)
# ============================================

STATUTS_LICENCE = {
    "ACTIVE": {"label": "Active", "color": "#10B981"},
    "SUSPENDUE": {"label": "Suspendue", "color": "#F59E0B"},
    "EXPIREE": {"label": "Expiree", "color": "#EF4444"},
    "REVOQUEE": {"label": "Revoquee", "color": "#1F2937"},
}

STATUTS_CARTE_CCQ = {
    "ACTIVE": {"label": "Active", "color": "#10B981"},
    "SUSPENDUE": {"label": "Suspendue", "color": "#F59E0B"},
    "EXPIREE": {"label": "Expiree", "color": "#EF4444"},
}

STATUTS_ATTESTATION = {
    "VALIDE": {"label": "Valide", "color": "#10B981"},
    "EN_RENOUVELLEMENT": {"label": "En renouvellement", "color": "#F59E0B"},
    "EXPIREE": {"label": "Expiree", "color": "#EF4444"},
}

NIVEAUX_RISQUE = {
    "FAIBLE": {"label": "Faible", "color": "#10B981"},
    "MOYEN": {"label": "Moyen", "color": "#F59E0B"},
    "ELEVE": {"label": "Eleve", "color": "#F97316"},
    "CRITIQUE": {"label": "Critique", "color": "#EF4444"},
}

PRIORITES = {
    "HAUTE": {"label": "Haute", "color": "#EF4444"},
    "MOYENNE": {"label": "Moyenne", "color": "#F59E0B"},
    "BASSE": {"label": "Basse", "color": "#10B981"},
}

GRAVITE_NON_CONFORMITE = {
    "MINEURE": {"label": "Mineure", "color": "#F59E0B"},
    "MAJEURE": {"label": "Majeure", "color": "#F97316"},
    "CRITIQUE": {"label": "Critique", "color": "#EF4444"},
}


# ============================================
# CATEGORIES RBQ (26 official categories per Streamlit)
# Source: Loi sur le batiment, Regie du batiment du Quebec
# ============================================

CATEGORIES_RBQ = [
    {"code": "1.1", "label": "Entrepreneur en batiments residentiels neufs classe I",
     "groupe": "Generale"},
    {"code": "1.2", "label": "Entrepreneur en batiments residentiels neufs classe II",
     "groupe": "Generale"},
    {"code": "1.3", "label": "Entrepreneur en petits batiments",
     "groupe": "Generale"},
    {"code": "2", "label": "Entrepreneur en systemes de chauffage a air chaud",
     "groupe": "Mecanique"},
    {"code": "3", "label": "Entrepreneur en plomberie",
     "groupe": "Mecanique"},
    {"code": "4", "label": "Entrepreneur en electricite",
     "groupe": "Electricite"},
    {"code": "5.1", "label": "Entrepreneur en excavation et terrassement",
     "groupe": "Genie civil"},
    {"code": "5.2", "label": "Entrepreneur en fondations profondes",
     "groupe": "Genie civil"},
    {"code": "6", "label": "Entrepreneur en charpente et menuiserie",
     "groupe": "Structure"},
    {"code": "7", "label": "Entrepreneur en revetements exterieurs",
     "groupe": "Enveloppe"},
    {"code": "8", "label": "Entrepreneur en systemes interieurs",
     "groupe": "Finition"},
    {"code": "9", "label": "Entrepreneur en toitures",
     "groupe": "Enveloppe"},
    {"code": "10", "label": "Entrepreneur en isolation, etancheite, couvertures et revetements metalliques",
     "groupe": "Enveloppe"},
    {"code": "11.1", "label": "Entrepreneur en structures de beton",
     "groupe": "Structure"},
    {"code": "11.2", "label": "Entrepreneur en beton prefabrique",
     "groupe": "Structure"},
    {"code": "12", "label": "Entrepreneur en armature et ferraillage",
     "groupe": "Structure"},
    {"code": "13", "label": "Entrepreneur en structures metalliques et elements prefabriques",
     "groupe": "Structure"},
    {"code": "14", "label": "Entrepreneur en maconnerie",
     "groupe": "Structure"},
    {"code": "15.1", "label": "Entrepreneur en systemes de chauffage a eau chaude",
     "groupe": "Mecanique"},
    {"code": "15.2", "label": "Entrepreneur en systemes de chauffage a vapeur",
     "groupe": "Mecanique"},
    {"code": "15.3", "label": "Entrepreneur en systemes de bruleurs au mazout",
     "groupe": "Mecanique"},
    {"code": "15.4", "label": "Entrepreneur en systemes de bruleurs au gaz",
     "groupe": "Mecanique"},
    {"code": "15.5", "label": "Entrepreneur en ventilation",
     "groupe": "Mecanique"},
    {"code": "15.6", "label": "Entrepreneur en climatisation",
     "groupe": "Mecanique"},
    {"code": "15.7", "label": "Entrepreneur en refrigeration",
     "groupe": "Mecanique"},
    {"code": "15.8", "label": "Entrepreneur en protection-incendie",
     "groupe": "Mecanique"},
    {"code": "16", "label": "Entrepreneur general",
     "groupe": "Generale"},
]


# ============================================
# METIERS CCQ (28 trades with dynamic qualifications)
# Source: Commission de la construction du Quebec - Loi R-20
# Qualification types:
#   - "COMPAGNON" : single compagnon level
#   - List of qualifications : multi-level progression
# ============================================

METIERS_CCQ = [
    {"nom": "Apprenti", "qualifications": ["1re periode", "2e periode", "3e periode", "4e periode"]},
    {"nom": "Briqueteur-macon", "qualifications": ["Compagnon"]},
    {"nom": "Calorifugeur", "qualifications": ["Compagnon"]},
    {"nom": "Carreleur", "qualifications": ["Compagnon"]},
    {"nom": "Charpentier-menuisier", "qualifications": ["Compagnon"]},
    {"nom": "Chaudronnier", "qualifications": ["Compagnon"]},
    {"nom": "Cimentier-applicateur", "qualifications": ["Compagnon"]},
    {"nom": "Couvreur", "qualifications": ["Compagnon"]},
    {"nom": "Electricien", "qualifications": ["Compagnon"]},
    {"nom": "Ferblantier", "qualifications": ["Compagnon"]},
    {"nom": "Ferrailleur", "qualifications": ["Compagnon"]},
    {"nom": "Frigoriste", "qualifications": ["Compagnon"]},
    {"nom": "Grutier", "qualifications": ["Classe 1", "Classe 2", "Classe 3", "Classe 4"]},
    {"nom": "Mecanicien d'ascenseur", "qualifications": ["Compagnon"]},
    {"nom": "Mecanicien de chantier", "qualifications": ["Compagnon"]},
    {"nom": "Mecanicien en protection-incendie", "qualifications": ["Compagnon"]},
    {"nom": "Monteur-assembleur", "qualifications": ["Compagnon"]},
    {"nom": "Monteur-mecanicien (vitrier)", "qualifications": ["Compagnon"]},
    {"nom": "Operateur d'equipement lourd", "qualifications": ["Classe 1", "Classe 2", "Classe 3", "Classe 4"]},
    {"nom": "Operateur de pelles mecaniques", "qualifications": ["Compagnon"]},
    {"nom": "Peintre", "qualifications": ["Compagnon"]},
    {"nom": "Platrier", "qualifications": ["Compagnon"]},
    {"nom": "Plombier", "qualifications": ["Compagnon"]},
    {"nom": "Poseur de revetements souples", "qualifications": ["Compagnon"]},
    {"nom": "Poseur de systemes interieurs", "qualifications": ["Compagnon"]},
    {"nom": "Soudeur", "qualifications": ["Classe A", "Classe B", "Classe C"]},
    {"nom": "Soudeur en tuyauterie", "qualifications": ["Classe A", "Classe B"]},
    {"nom": "Tuyauteur", "qualifications": ["Compagnon"]},
]


# ============================================
# TYPES D'ATTESTATIONS (5 types per Streamlit)
# ============================================

TYPES_ATTESTATION = [
    {"code": "REVENU_QUEBEC", "label": "Attestation de Revenu Quebec",
     "organisme": "Revenu Quebec", "description": "Conformite fiscale provinciale"},
    {"code": "ARC", "label": "Attestation de l'Agence du revenu du Canada",
     "organisme": "Agence du revenu du Canada", "description": "Conformite fiscale federale"},
    {"code": "CNESST", "label": "Attestation de conformite CNESST",
     "organisme": "CNESST", "description": "Sante et securite au travail"},
    {"code": "CCQ", "label": "Attestation CCQ - Etat de situation",
     "organisme": "Commission de la construction du Quebec", "description": "Etat des cotisations"},
    {"code": "RBQ", "label": "Attestation de solvabilite RBQ",
     "organisme": "Regie du batiment du Quebec", "description": "Solvabilite et cautionnement"},
]


# ============================================
# Types de projets pour verification (7 types)
# ============================================

TYPES_PROJET = [
    "Residentiel unifamilial",
    "Residentiel multifamilial",
    "Commercial",
    "Industriel",
    "Institutionnel",
    "Renovation majeure",
    "Agrandissement",
]


# ============================================
# Regions du Quebec (17 regions administratives + Autre)
# ============================================

REGIONS_PROJET = [
    "Bas-Saint-Laurent",
    "Saguenay-Lac-Saint-Jean",
    "Capitale-Nationale",
    "Mauricie",
    "Estrie",
    "Montreal",
    "Outaouais",
    "Abitibi-Temiscamingue",
    "Cote-Nord",
    "Nord-du-Quebec",
    "Gaspesie-Iles-de-la-Madeleine",
    "Chaudiere-Appalaches",
    "Laval",
    "Lanaudiere",
    "Laurentides",
    "Monteregie",
    "Centre-du-Quebec",
    "Autre region",
]


# ============================================
# Types de travaux pour verification projet (12 types)
# ============================================

TYPES_TRAVAUX = [
    "Fondation",
    "Charpente",
    "Electricite",
    "Plomberie",
    "Chauffage/Ventilation",
    "Toiture",
    "Revetement exterieur",
    "Finition interieure",
    "Maconnerie",
    "Structure metallique",
    "Excavation",
    "Piscine",
]


# ============================================
# Types de projets prevus pour recommandations formations
# ============================================

TYPES_PROJET_FORMATION = [
    "Residentiel",
    "Commercial",
    "Industriel",
    "Institutionnel",
    "Infrastructure",
]


# ============================================
# ORGANISMES de conformite (8 partner organizations)
# ============================================

DEFAULT_ORGANISMES = [
    {
        "nom": "Regie du batiment du Quebec (RBQ)",
        "role": "Delivrance des licences, surveillance, cautionnement",
        "contact": "1 800 361-0761",
        "url": "https://www.rbq.gouv.qc.ca",
    },
    {
        "nom": "Commission de la construction du Quebec (CCQ)",
        "role": "Gestion des cartes de competence et relations de travail R-20",
        "contact": "1 888 842-8282",
        "url": "https://www.ccq.org",
    },
    {
        "nom": "CNESST",
        "role": "Sante et securite au travail, indemnisation",
        "contact": "1 844 838-0808",
        "url": "https://www.cnesst.gouv.qc.ca",
    },
    {
        "nom": "Revenu Quebec",
        "role": "Attestations fiscales provinciales",
        "contact": "1 800 267-6299",
        "url": "https://www.revenuquebec.ca",
    },
    {
        "nom": "Agence du revenu du Canada (ARC)",
        "role": "Attestations fiscales federales",
        "contact": "1 800 959-7775",
        "url": "https://www.canada.ca/fr/agence-revenu.html",
    },
    {
        "nom": "ASP Construction",
        "role": "Formation sante et securite dans la construction",
        "contact": "1 800 361-2061",
        "url": "https://www.asp-construction.org",
    },
    {
        "nom": "Ombudsman de la construction",
        "role": "Mediation des differends dans l'industrie",
        "contact": "514 864-7873",
        "url": "https://www.rbq.gouv.qc.ca/ombudsman",
    },
    {
        "nom": "Corporation des maitres electriciens du Quebec (CMEQ)",
        "role": "Association professionnelle des electriciens",
        "contact": "1 800 361-9061",
        "url": "https://www.cmeq.org",
    },
]


# ============================================
# CONSEILS PRATIQUES (6 sections)
# ============================================

CONSEILS_PRATIQUES = [
    {
        "titre": "Surveiller les dates d'expiration",
        "items": [
            "Verifiez les dates d'expiration des licences RBQ 90 jours avant echeance",
            "Planifiez les renouvellements des cartes CCQ en fonction des heures travaillees",
            "Renouvelez les attestations fiscales avant soumission d'appels d'offres",
            "Conservez une liste calendrier centralisee des echeances",
        ],
    },
    {
        "titre": "Maintenir la conformite financiere",
        "items": [
            "Conservez le cautionnement minimum requis pour votre categorie RBQ",
            "Assurez-vous d'avoir une assurance responsabilite civile suffisante",
            "Payez les cotisations CCQ dans les delais pour eviter les penalites",
            "Tenez a jour les attestations de Revenu Quebec, ARC et CNESST",
        ],
    },
    {
        "titre": "Gerer les cartes de competence",
        "items": [
            "Verifiez que vos employes detiennent la bonne classe ou periode",
            "Respectez le ratio compagnon/apprenti obligatoire sur les chantiers",
            "Conservez les certificats ASP Construction a jour (carte de competence requise)",
            "Documentez les heures travaillees pour le renouvellement automatique CCQ",
        ],
    },
    {
        "titre": "Preparer les demarrages de chantier",
        "items": [
            "Verifiez que votre licence RBQ couvre bien le type de travaux du projet",
            "Obtenez les permis municipaux et provinciaux requis avant le debut",
            "Affichez les attestations RBQ et CNESST sur le chantier",
            "Informez les sous-traitants des exigences de conformite",
        ],
    },
    {
        "titre": "Prevenir les sanctions",
        "items": [
            "Ne jamais executer de travaux hors de votre categorie de licence",
            "Respecter les regles de la Loi R-20 sur les relations du travail",
            "Declarer correctement les heures et les salaires a la CCQ",
            "Corriger rapidement toute non-conformite detectee par la RBQ",
        ],
    },
    {
        "titre": "Developper les competences de l'equipe",
        "items": [
            "Planifier la formation continue des travailleurs (CCQ, ASP, autres)",
            "Suivre les nouvelles normes du Code de construction du Quebec",
            "Participer aux formations sur les changements reglementaires",
            "Encourager la progression des apprentis vers le statut de compagnon",
        ],
    },
]


# ============================================
# AI SYSTEM PROMPT (Claude Opus 4.6 expert)
# ============================================

AI_SYSTEM_PROMPT = """Tu es un expert en reglementation de la construction au Quebec specialise en conformite RBQ/CCQ.

Tu maitrises parfaitement:
- La Regie du batiment du Quebec (RBQ) et ses 26 categories officielles de licences (1.1 a 16)
- La Commission de la construction du Quebec (CCQ) et les 25+ metiers reglementes
- La Loi sur le batiment (chapitre B-1.1)
- Le Code de construction du Quebec (chapitre I, Batiment)
- Le Code de securite (chapitre VIII)
- Les exigences de cautionnement et d'assurance responsabilite civile
- Les attestations fiscales (Revenu Quebec, ARC, CNESST, CCQ, RBQ)
- La Loi R-20 sur les relations du travail dans l'industrie de la construction
- Les bassins de main-d'oeuvre et la mobilite inter-regionale
- Les examens de qualification et les cartes de competence
- Le ratio compagnon/apprenti obligatoire sur les chantiers
- Les formations obligatoires ASP Construction

Reponds toujours en francais quebecois, de maniere claire, precise et professionnelle.
Cite les articles de loi ou reglements pertinents quand c'est approprie.
Si tu n'es pas sur, indique-le clairement et recommande de consulter la RBQ ou CCQ directement.
N'invente jamais de numeros de loi ou d'articles. Prefere indiquer 'a verifier' plutot que fabriquer une reference.
"""
