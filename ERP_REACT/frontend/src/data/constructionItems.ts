/**
 * Template Construction Quebec — 9 categories (0.0 a 8.0).
 * Sections fixes du sous-module Manuel des Soumissions.
 * Les sections/lignes personnalisees sont gerees separement via useManuelTemplateStore.
 */

export interface ConstructionItem {
  id: string;
  title: string;
  description: string;
}

export interface ConstructionCategory {
  id: string;
  name: string;
  items: ConstructionItem[];
}

export interface SelectedItem {
  itemId: string;
  categoryId: string;
  categoryName: string;
  title: string;
  description: string;
  quantite: number;
  unite: string;
  prixUnitaire: number;
  montant: number;
}

export interface ConstructionConfig {
  adminPct: number;
  contingencesPct: number;
  profitPct: number;
}

export const DEFAULT_CONFIG: ConstructionConfig = {
  adminPct: 3,
  contingencesPct: 12,
  profitPct: 15,
};

export const CATEGORIES_CONSTRUCTION: ConstructionCategory[] = [
  {
    id: '0', name: '0.0 - Travaux Preparatoires et Demolition',
    items: [
      { id: '0-1', title: 'Permis et etudes', description: 'Permis de construction, etude geotechnique, certificat de localisation, test de percolation (si requis).' },
      { id: '0-2', title: 'Demolition et decontamination', description: 'Demolition de structures existantes, decontamination (amiante, vermiculite si applicable), disposition des debris.' },
      { id: '0-3', title: 'Preparation du terrain et services temporaires', description: 'Deboisement, essouchement, nivellement, protection des arbres, electricite temporaire, toilette de chantier, cloture.' },
    ],
  },
  {
    id: '1', name: '1.0 - Fondation, Infrastructure et Services',
    items: [
      { id: '1-1', title: 'Excavation et remblai', description: 'Excavation generale, remblai granulaire compacte, pierre concassee, membrane geotextile.' },
      { id: '1-2', title: 'Fondation complete', description: 'Beton 30 MPA, armature 15M, coffrage, coulee, finition, cure, isolant R-10 sous-dalle, pare-vapeur.' },
      { id: '1-3', title: 'Drainage et impermeabilisation', description: "Drain francais, membrane d'impermeabilisation, panneau de drainage, pompe de puisard." },
      { id: '1-4', title: 'Raccordements et services', description: "Egout, aqueduc, pluvial (jusqu'a 50'), systeme septique si applicable." },
    ],
  },
  {
    id: '2', name: '2.0 - Structure et Charpente',
    items: [
      { id: '2-1', title: 'Structure de plancher', description: 'Poutrelles ajourees 14", solives de rive, contreventement, sous-plancher 3/4" colle-visse.' },
      { id: '2-2', title: 'Murs porteurs et cloisons', description: 'Montants 2x6 @ 16" c/c murs exterieurs, 2x4 @ 16" c/c cloisons, lisses, sablieres doubles, linteaux.' },
      { id: '2-3', title: 'Structure de toit', description: 'Fermes prefabriquees ou chevrons/solives selon plans, contreventement, support de toit 5/8".' },
      { id: '2-4', title: 'Elements structuraux speciaux', description: "Poutres et colonnes d'acier, poutres LVL, colonnes decoratives, quincaillerie structurale." },
    ],
  },
  {
    id: '3', name: '3.0 - Enveloppe Exterieure',
    items: [
      { id: '3-1', title: 'Toiture - Materiaux', description: 'Bardeaux architecturaux 30 ans, membrane autocollante, papier #15, ventilation de toit, events de plomberie.' },
      { id: '3-2', title: "Toiture - Main-d'oeuvre et ferblanterie", description: 'Installation bardeaux, solins, noues, faitieres, gouttieres 5", descentes pluviales, protege-gouttieres.' },
      { id: '3-3', title: 'Revetements muraux - Materiaux', description: 'Maconnerie, fibrociment, vinyle/acier, fourrures, pare-air Tyvek, solins.' },
      { id: '3-4', title: "Revetements muraux - Main-d'oeuvre", description: 'Installation complete des revetements, calfeutrage, scellants, finition des coins et jonctions.' },
      { id: '3-5', title: 'Portes et fenetres', description: 'Fenetres PVC/hybride, double vitrage Low-E argon, portes exterieures, porte patio, portes de garage isolees.' },
      { id: '3-6', title: 'Soffites, fascias et accessoires', description: "Soffites ventiles aluminium, fascias aluminium, moulures de finition, ventilation d'entretoit." },
      { id: '3-7', title: 'Structures exterieures', description: 'Balcons, terrasses, garde-corps aluminium/verre, escaliers exterieurs, auvents, pergola.' },
      { id: '3-8', title: 'Maconnerie decorative et cheminee', description: 'Cheminee prefabriquee, revetement de pierre/brique, couronnement, chapeau de cheminee.' },
    ],
  },
  {
    id: '4', name: '4.0 - Systemes Mecaniques et Electriques',
    items: [
      { id: '4-1', title: 'Plomberie - Distribution et drainage', description: "Tuyauterie PEX/cuivre, drainage ABS, valves d'arret, clapets antiretour, supports et isolant de tuyaux." },
      { id: '4-2', title: 'Plomberie - Appareils et accessoires', description: "Salles de bain completes, evier cuisine double, chauffe-eau, adoucisseur d'eau, robinetterie exterieure." },
      { id: '4-3', title: 'Chauffage au sol (si applicable)', description: 'Plancher radiant, chaudiere haute efficacite, pompes de circulation, controles.' },
      { id: '4-4', title: 'Electricite - Distribution principale', description: 'Panneau 200A/40 circuits, mise a terre, cablage principal, sous-panneau garage, protection surtension.' },
      { id: '4-5', title: 'Electricite - Filage et dispositifs', description: 'Cablage complet Romex, prises, interrupteurs, circuits dedies, prises DDFT, detecteurs.' },
      { id: '4-6', title: 'Eclairage et controles', description: 'Luminaires encastres, eclairage sous-armoires, gradateurs, eclairage exterieur, commandes intelligentes.' },
      { id: '4-7', title: 'CVAC - Equipements principaux', description: "Thermopompe centrale, fournaise d'appoint gaz/electrique, humidificateur, filtre HEPA." },
      { id: '4-8', title: 'CVAC - Distribution et ventilation', description: 'Conduits isoles, grilles et diffuseurs, VRC/VRE, ventilateurs salles de bain, hotte cuisine.' },
      { id: '4-9', title: 'Systemes specialises', description: 'Pre-filage alarme/cameras, aspirateur central, audio integre, reseau informatique Cat6, borne VE 240V.' },
    ],
  },
  {
    id: '5', name: '5.0 - Isolation et Etancheite',
    items: [
      { id: '5-1', title: 'Isolation thermique', description: 'Murs ext. R-24.5, plafond cathedrale R-31, grenier R-50, sous-sol R-20, solives de rive R-20.' },
      { id: '5-2', title: "Etancheite a l'air", description: 'Pare-vapeur 6 mil, scellant acoustique, ruban Tuck Tape, mousse expansive, coupe-froid.' },
      { id: '5-3', title: 'Insonorisation', description: 'Laine acoustique entre etages, barres resilientes, scellant acoustique, isolant plomberie.' },
      { id: '5-4', title: 'Tests et certification', description: "Test d'infiltrometrie, thermographie, certification Novoclimat Select, rapport de conformite." },
    ],
  },
  {
    id: '6', name: '6.0 - Finitions Interieures',
    items: [
      { id: '6-1', title: 'Cloisons seches - Gypse', description: 'Gypse 1/2" regulier et hydrofuge, gypse 5/8" plafonds, coins metalliques, finition niveau 4.' },
      { id: '6-2', title: 'Peinture et finition murale', description: 'Appret, peinture 2 couches (murs/plafonds), peinture email (boiseries), papier-peint.' },
      { id: '6-3', title: 'Revetements de plancher', description: 'Bois franc/ingenierie, ceramique, tapis, vinyle luxe, sous-planchers.' },
      { id: '6-4', title: 'Carrelage et dosseret', description: 'Ceramique salles de bain (plancher/murs douche), dosseret cuisine, membrane Schluter, joints epoxy.' },
      { id: '6-5', title: 'Ebenisterie - Cuisine', description: 'Armoires thermoplastique/bois, comptoir quartz/granit, ilot, pantry, quincaillerie soft-close.' },
      { id: '6-6', title: 'Ebenisterie - Salles de bain et autres', description: 'Vanites salles de bain, lingerie, walk-in amenage, rangement entree, bureau integre.' },
      { id: '6-7', title: 'Menuiserie interieure', description: 'Portes interieures, cadres et moulures, plinthes, cimaises, tablettes decoratives.' },
      { id: '6-8', title: 'Escaliers et rampes', description: 'Escaliers bois franc/MDF, main courante, barreaux metal/bois, poteaux decoratifs.' },
      { id: '6-9', title: 'Finition sous-sol (si applicable)', description: 'Divisions, isolation, gypse, plancher flottant/epoxy, plafond suspendu, salle mecanique finie.' },
      { id: '6-10', title: 'Accessoires et quincaillerie', description: 'Poignees de porte, crochets, barres a serviettes, miroirs, tablettes garde-robes, cache-radiateurs.' },
    ],
  },
  {
    id: '7', name: '7.0 - Amenagement Exterieur et Garage',
    items: [
      { id: '7-1', title: 'Terrassement et nivellement', description: 'Nivellement final, terre vegetale, ensemencement gazon, arbres et arbustes de base.' },
      { id: '7-2', title: 'Surfaces dures', description: 'Entree asphalte/pave uni, trottoirs beton/pave, bordures, patio beton/composite.' },
      { id: '7-3', title: 'Clotures et structures', description: 'Cloture, portail, muret decoratif, pergola, cabanon prefabrique.' },
      { id: '7-4', title: 'Eclairage exterieur et irrigation', description: "Eclairage paysager, lampadaires, systeme d'irrigation (si applicable), minuteries." },
      { id: '7-5', title: 'Finition garage', description: 'Dalle beton finie, murs gypse peint, eclairage, prises electriques, rangement, porte de service.' },
    ],
  },
  {
    id: '8', name: '8.0 - Machinerie',
    items: [
      { id: '8-1', title: 'Excavatrice (location)', description: 'Excavatrice 8-20 tonnes avec operateur, transport au chantier, carburant inclus.' },
      { id: '8-2', title: 'Pelle mecanique / Mini-pelle', description: 'Mini-pelle 1-5 tonnes pour travaux precis, tranchees, espaces restreints, avec operateur.' },
      { id: '8-3', title: 'Bulldozer / Chargeuse', description: 'Bulldozer ou chargeuse sur roues pour terrassement, deplacement de terre, nivellement grossier.' },
      { id: '8-4', title: 'Camion benne / Transport', description: 'Transport materiaux granulaires, terre, debris. Tarif horaire + transport (camion 6 ou 10 roues).' },
      { id: '8-5', title: 'Compacteur / Rouleau', description: 'Compacteur a plaque vibrante, rouleau vibrant pour compaction granulaire et asphalte.' },
      { id: '8-6', title: 'Grue mobile', description: 'Grue mobile pour levage fermes de toit, structures, charges lourdes, avec operateur certifie.' },
      { id: '8-7', title: 'Nacelle / Plateforme elevatrice', description: 'Nacelle articulee ou ciseaux pour travaux en hauteur, revetements, soffites, electricite.' },
      { id: '8-8', title: 'Chariot elevateur / Telehandler', description: 'Telehandler ou chariot elevateur pour manutention de materiaux sur chantier.' },
    ],
  },
];
