import type { Measurement, Product, LaborTrade } from '../types';
import { PRICE_UNITS } from '../types';

/* ── helpers ─────────────────────────────────── */

function fmt(n: number): string {
  if (!isFinite(n)) return '0,00';
  const abs = Math.abs(n);
  const formatted = abs
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    .replace('.', ',');
  return n < 0 ? `−${formatted}` : formatted;
}

function unitLabel(val: string): string {
  return PRICE_UNITS.find((u) => u.value === val)?.label ?? val;
}

function today(): string {
  const d = new Date();
  return d.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Construction sections (47 items, 8 sections) ── */

interface ConstructionItem {
  id: string;
  title: string;
  description: string;
}

interface ConstructionSection {
  id: string;
  name: string;
  items: ConstructionItem[];
}

const CONSTRUCTION_SECTIONS: ConstructionSection[] = [
  {
    id: '0',
    name: '0.0 - Travaux Préparatoires et Démolition',
    items: [
      { id: '0-1', title: 'Permis et études', description: 'Permis de construction, étude géotechnique, certificat de localisation, test de percolation (si requis).' },
      { id: '0-2', title: 'Démolition et décontamination', description: 'Démolition de structures existantes, décontamination (amiante, vermiculite si applicable), disposition des débris.' },
      { id: '0-3', title: 'Préparation du terrain et services temporaires', description: 'Déboisement, essouchement, nivellement, protection des arbres, électricité temporaire, toilette de chantier, clôture.' },
    ],
  },
  {
    id: '1',
    name: '1.0 - Fondation, Infrastructure et Services',
    items: [
      { id: '1-1', title: 'Excavation et remblai', description: 'Excavation générale, remblai granulaire compacté, pierre concassée, membrane géotextile.' },
      { id: '1-2', title: 'Fondation complète', description: 'Béton 30 MPA, armature 15M, coffrage, coulée, finition, cure, isolant R-10 sous-dalle, pare-vapeur.' },
      { id: '1-3', title: 'Drainage et imperméabilisation', description: "Drain français, membrane d'imperméabilisation, panneau de drainage, pompe de puisard." },
      { id: '1-4', title: 'Raccordements et services', description: "Égout, aqueduc, pluvial (jusqu'à 50'), système septique si applicable (fosse et champ selon Q-2, r.22)." },
    ],
  },
  {
    id: '2',
    name: '2.0 - Structure et Charpente',
    items: [
      { id: '2-1', title: 'Structure de plancher', description: 'Poutrelles ajourées 14", solives de rive, contreventement, sous-plancher 3/4" collé-vissé.' },
      { id: '2-2', title: 'Murs porteurs et cloisons', description: 'Montants 2x6 @ 16" c/c murs extérieurs, 2x4 @ 16" c/c cloisons, lisses, sablières doubles, linteaux.' },
      { id: '2-3', title: 'Structure de toit', description: 'Fermes préfabriquées ou chevrons/solives selon plans, contreventement, support de toit 5/8".' },
      { id: '2-4', title: 'Éléments structuraux spéciaux', description: "Poutres et colonnes d'acier, poutres LVL, colonnes décoratives, quincaillerie structurale." },
    ],
  },
  {
    id: '3',
    name: '3.0 - Enveloppe Extérieure',
    items: [
      { id: '3-1', title: 'Toiture - Matériaux', description: 'Bardeaux architecturaux 30 ans, membrane autocollante, papier #15, ventilation de toit, évents de plomberie.' },
      { id: '3-2', title: "Toiture - Main-d'oeuvre et ferblanterie", description: 'Installation bardeaux, solins, noues, faîtières, gouttières 5", descentes pluviales, protège-gouttières.' },
      { id: '3-3', title: 'Revêtements muraux - Matériaux', description: 'Maçonnerie (___%), fibrociment (___%), vinyle/acier (___%), fourrures, pare-air Tyvek, solins.' },
      { id: '3-4', title: "Revêtements muraux - Main-d'oeuvre", description: 'Installation complète des revêtements, calfeutrage, scellants, finition des coins et jonctions.' },
      { id: '3-5', title: 'Portes et fenêtres', description: '___ fenêtres PVC/hybride, double vitrage Low-E argon, ___ portes extérieures, porte patio, portes de garage isolées.' },
      { id: '3-6', title: 'Soffites, fascias et accessoires', description: "Soffites ventilés aluminium, fascias aluminium, moulures de finition, ventilation d'entretoit." },
      { id: '3-7', title: 'Structures extérieures', description: 'Balcons, terrasses, garde-corps aluminium/verre, escaliers extérieurs, auvents, pergola (si applicable).' },
      { id: '3-8', title: 'Maçonnerie décorative et cheminée', description: 'Cheminée préfabriquée, revêtement de pierre/brique, couronnement, chapeau de cheminée.' },
    ],
  },
  {
    id: '4',
    name: '4.0 - Systèmes Mécaniques et Électriques',
    items: [
      { id: '4-1', title: 'Plomberie - Distribution et drainage', description: "Tuyauterie PEX/cuivre, drainage ABS, valves d'arrêt, clapets antiretour, supports et isolant de tuyaux." },
      { id: '4-2', title: 'Plomberie - Appareils et accessoires', description: "___ salles de bain complètes, évier cuisine double, chauffe-eau ___gal, adoucisseur d'eau, robinetterie extérieure." },
      { id: '4-3', title: 'Chauffage au sol (si applicable)', description: 'Plancher radiant ___ zones, chaudière haute efficacité, pompes de circulation, contrôles.' },
      { id: '4-4', title: 'Électricité - Distribution principale', description: 'Panneau 200A/40 circuits, mise à terre, câblage principal, sous-panneau garage, protection surtension.' },
      { id: '4-5', title: 'Électricité - Filage et dispositifs', description: 'Câblage complet Romex, ___ prises, ___ interrupteurs, circuits dédiés, prises DDFT, détecteurs.' },
      { id: '4-6', title: 'Éclairage et contrôles', description: '___ luminaires encastrés, éclairage sous-armoires, gradateurs, éclairage extérieur, commandes intelligentes.' },
      { id: '4-7', title: 'CVAC - Équipements principaux', description: "Thermopompe centrale ___ tonnes, fournaise d'appoint gaz/électrique, humidificateur, filtre HEPA." },
      { id: '4-8', title: 'CVAC - Distribution et ventilation', description: 'Conduits isolés, grilles et diffuseurs, VRC/VRE ___ PCM, ventilateurs salles de bain, hotte cuisine.' },
      { id: '4-9', title: 'Systèmes spécialisés', description: 'Pré-filage alarme/caméras, aspirateur central, audio intégré, réseau informatique Cat6, borne VÉ 240V.' },
    ],
  },
  {
    id: '5',
    name: '5.0 - Isolation et Étanchéité',
    items: [
      { id: '5-1', title: 'Isolation thermique', description: 'Murs ext. R-24.5, plafond cathédrale R-31, grenier R-50, sous-sol R-20, solives de rive R-20.' },
      { id: '5-2', title: "Étanchéité à l'air", description: 'Pare-vapeur 6 mil, scellant acoustique, ruban Tuck Tape, mousse expansive, coupe-froid.' },
      { id: '5-3', title: 'Insonorisation', description: 'Laine acoustique entre étages, barres résilientes, scellant acoustique, isolant plomberie.' },
      { id: '5-4', title: 'Tests et certification', description: "Test d'infiltrométrie, thermographie, certification Novoclimat Select, rapport de conformité." },
    ],
  },
  {
    id: '6',
    name: '6.0 - Finitions Intérieures',
    items: [
      { id: '6-1', title: 'Cloisons sèches - Gypse', description: 'Gypse 1/2" régulier et hydrofuge, gypse 5/8" plafonds, coins métalliques, finition niveau 4.' },
      { id: '6-2', title: 'Peinture et finition murale', description: 'Apprêt, peinture 2 couches (murs/plafonds), peinture émail (boiseries), papier-peint (si applicable).' },
      { id: '6-3', title: 'Revêtements de plancher', description: 'Bois franc/ingénierie ___pi², céramique ___pi², tapis ___pi², vinyle luxe ___pi², sous-planchers.' },
      { id: '6-4', title: 'Carrelage et dosseret', description: 'Céramique salles de bain (plancher/murs douche), dosseret cuisine, membrane Schluter, joints époxy.' },
      { id: '6-5', title: 'Ébénisterie - Cuisine', description: 'Armoires thermoplastique/bois, comptoir quartz/granit ___pi lin, îlot, pantry, quincaillerie soft-close.' },
      { id: '6-6', title: 'Ébénisterie - Salles de bain et autres', description: 'Vanités ___ salles de bain, lingerie, walk-in aménagé, rangement entrée, bureau intégré.' },
      { id: '6-7', title: 'Menuiserie intérieure', description: '___ portes intérieures, cadres et moulures, plinthes, cimaises, tablettes décoratives.' },
      { id: '6-8', title: 'Escaliers et rampes', description: '___ escaliers bois franc/MDF, main courante, barreaux métal/bois, poteaux décoratifs.' },
      { id: '6-9', title: 'Finition sous-sol (si applicable)', description: 'Divisions, isolation, gypse, plancher flottant/époxy, plafond suspendu, salle mécanique finie.' },
      { id: '6-10', title: 'Accessoires et quincaillerie', description: 'Poignées de porte, crochets, barres à serviettes, miroirs, tablettes garde-robes, cache-radiateurs.' },
    ],
  },
  {
    id: '7',
    name: '7.0 - Aménagement Extérieur et Garage',
    items: [
      { id: '7-1', title: 'Terrassement et nivellement', description: 'Nivellement final, terre végétale, ensemencement gazon, arbres et arbustes de base.' },
      { id: '7-2', title: 'Surfaces dures', description: 'Entrée asphalte/pavé uni, trottoirs béton/pavé, bordures, patio béton/composite.' },
      { id: '7-3', title: 'Clôtures et structures', description: 'Clôture ___, portail, muret décoratif, pergola, cabanon préfabriqué.' },
      { id: '7-4', title: 'Éclairage extérieur et irrigation', description: "Éclairage paysager, lampadaires, système d'irrigation (si applicable), minuteries." },
      { id: '7-5', title: 'Finition garage', description: 'Dalle béton finie, murs gypse peint, éclairage, prises électriques, rangement, porte de service.' },
    ],
  },
];

/* ── types ───────────────────────────────────── */

export interface EstimationData {
  measurements: Measurement[];
  products: Product[];
  laborTrades?: LaborTrade[];
  groups: string[];
  getNetValue: (m: Measurement) => number;
  projectName?: string;
  projectAddress?: string;
  projectType?: string;
  projectArea?: string;
  clientName?: string;
  clientAddress?: string;
  clientCity?: string;
  clientPhone?: string;
  clientEmail?: string;
}

/* ── Build measurement reference rows ─────────── */

function buildMeasurementRows(data: EstimationData): string {
  const { measurements, products, getNetValue } = data;
  const linked = measurements.filter((m) => m.productId);
  if (linked.length === 0) return '';

  interface CatGroup {
    category: string;
    items: { name: string; label: string; qty: number; qtyWaste: number; unit: string; price: number; total: number; wastePct: number; isDeduction: boolean }[];
    subtotal: number;
  }
  const catMap = new Map<string, CatGroup>();

  for (const m of linked) {
    const prod = products.find((p) => p.id === m.productId);
    if (!prod) continue;
    const slopeFactor = m.slopeFactor ?? 1;
    const isDeduction = m.isDeduction ?? false;
    const netQty = isDeduction ? 0 : getNetValue(m) * slopeFactor;
    const wasteFactor = 1 + (prod.wastePct || 0) / 100;
    const qtyWithWaste = isDeduction ? 0 : netQty * wasteFactor;
    const cost = isDeduction ? 0 : qtyWithWaste * prod.price;

    if (!catMap.has(prod.category)) {
      catMap.set(prod.category, { category: prod.category, items: [], subtotal: 0 });
    }
    const cat = catMap.get(prod.category)!;
    cat.items.push({
      name: prod.name,
      label: m.label || `${m.type} #${m.id.slice(-4)}`,
      qty: isDeduction ? -(m.quantity ?? m.value) * slopeFactor : netQty,
      qtyWaste: qtyWithWaste,
      unit: unitLabel(prod.priceUnit),
      price: prod.price,
      total: cost,
      wastePct: prod.wastePct || 0,
      isDeduction,
    });
    cat.subtotal += cost;
  }

  const categories = Array.from(catMap.values());
  if (categories.length === 0) return '';

  const totalMetre = categories.reduce((s, c) => s + c.subtotal, 0);

  let html = `
    <div class="section" style="margin-top:30px;">
      <div class="section-title" style="background: linear-gradient(135deg, #059669 0%, #047857 100%);">RÉFÉRENCE — MESURES DU MÉTRÉ (TAKE OFF)</div>
      <p style="font-size:9px; color:#6B7280; margin-bottom:10px; padding:0 4px;">
        Ces mesures proviennent du Take Off PDF. Utilisez-les comme référence pour remplir les items de construction ci-dessus.
      </p>`;

  for (const cat of categories) {
    html += `
      <table class="table" style="margin-bottom:12px;">
        <thead>
          <tr>
            <th colspan="7" style="text-align:left; font-size:10px; background: linear-gradient(135deg, #10b981 0%, #059669 100%);">${escHtml(cat.category.toUpperCase())}</th>
          </tr>
          <tr>
            <th style="width:30%">Produit / Mesure</th>
            <th style="width:12%; text-align:center">Quantité</th>
            <th style="width:10%; text-align:center">Unité</th>
            <th style="width:10%; text-align:center">Perte</th>
            <th style="width:13%; text-align:right">Qté + perte</th>
            <th style="width:12%; text-align:right">Prix unit.</th>
            <th style="width:13%; text-align:right">Montant</th>
          </tr>
        </thead>
        <tbody>
          ${cat.items.map((item) => `
          <tr${item.isDeduction ? ' style="background:#FEF2F2;"' : ''}>
            <td>
              <div style="font-weight:600;">${item.isDeduction ? '<span style="display:inline-block;background:#EF4444;color:white;font-size:8px;padding:1px 6px;border-radius:3px;margin-right:4px;">DÉDUCTION</span>' : ''}${escHtml(item.name)}</div>
              ${item.label && item.label !== item.name ? `<div style="font-size:9px; color:#6B7280; font-style:italic;">${escHtml(item.label)}</div>` : ''}
            </td>
            <td style="text-align:center; font-family:var(--font-mono);">${item.isDeduction ? `−${fmt(Math.abs(item.qty))}` : fmt(item.qty)}</td>
            <td style="text-align:center">${escHtml(item.unit)}</td>
            <td style="text-align:center">${item.isDeduction ? '—' : `${(item.wastePct ?? 0).toFixed(1)}%`}</td>
            <td style="text-align:right; font-family:var(--font-mono);">${item.isDeduction ? '—' : fmt(item.qtyWaste)}</td>
            <td style="text-align:right; font-family:var(--font-mono);">${fmt(item.price)} $</td>
            <td style="text-align:right; font-weight:bold; font-family:var(--font-mono);">${item.isDeduction ? '—' : `${fmt(item.total)} $`}</td>
          </tr>
          `).join('')}
          <tr class="subtotal-row">
            <td colspan="6">Sous-total — ${escHtml(cat.category)}</td>
            <td style="text-align:right; font-family:var(--font-mono);">${fmt(cat.subtotal)} $</td>
          </tr>
        </tbody>
      </table>`;
  }

  html += `
      <div style="text-align:right; padding:8px 12px; background:var(--card-bg); border-radius:var(--radius); border:1px solid var(--border-blue); font-weight:bold; font-size:12px;">
        Total des mesures du métré: <span style="font-family:var(--font-mono); color:var(--primary);">${fmt(totalMetre)} $</span>
      </div>
    </div>`;

  return html;
}

/* ── Build labor summary rows ────────────────── */

function buildLaborRows(data: EstimationData): string {
  const { measurements, laborTrades } = data;
  if (!laborTrades || laborTrades.length === 0) return '';

  interface LaborAgg { trade: string; sector: string; hourlyRate: number; totalHours: number; maxPersons: number; totalCost: number; color: string; }
  const map = new Map<string, LaborAgg>();

  for (const m of measurements) {
    if (!m.laborTradeId || m.isDeduction) continue;
    const trade = laborTrades.find((t) => t.id === m.laborTradeId);
    if (!trade) continue;
    const hours = m.laborHours ?? 0;
    if (hours <= 0) continue;
    const persons = m.laborPersons ?? trade.nbPersons;
    const cost = trade.hourlyRate * hours * persons;
    if (!map.has(trade.id)) map.set(trade.id, { trade: trade.trade, sector: trade.sector, hourlyRate: trade.hourlyRate, totalHours: 0, maxPersons: persons, totalCost: 0, color: trade.color });
    const row = map.get(trade.id)!;
    row.totalHours += hours;
    row.maxPersons = Math.max(row.maxPersons, persons);
    row.totalCost += cost;
  }

  const rows = Array.from(map.values()).sort((a, b) => a.trade.localeCompare(b.trade));
  if (rows.length === 0) return '';

  const totalLabor = rows.reduce((s, r) => s + r.totalCost, 0);

  let html = `
    <div class="section" style="margin-top:30px;">
      <div class="section-title" style="background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);">MAIN-D\u2019\u0152UVRE \u2014 CORPS DE M\u00c9TIERS CCQ</div>
      <table class="table" style="margin-bottom:12px;">
        <thead>
          <tr>
            <th style="width:30%">Corps de m\u00e9tier</th>
            <th style="width:15%; text-align:center">Secteur</th>
            <th style="width:15%; text-align:right">Taux horaire</th>
            <th style="width:12%; text-align:center">Heures</th>
            <th style="width:10%; text-align:center">Pers.</th>
            <th style="width:18%; text-align:right">Co\u00fbt</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
          <tr>
            <td>
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${escHtml(r.color)};margin-right:6px;vertical-align:middle;"></span>
              <strong>${escHtml(r.trade)}</strong>
            </td>
            <td style="text-align:center">${escHtml(r.sector)}</td>
            <td style="text-align:right; font-family:var(--font-mono);">${fmt(r.hourlyRate)} $/h</td>
            <td style="text-align:center; font-family:var(--font-mono);">${fmt(r.totalHours)}</td>
            <td style="text-align:center">${r.maxPersons}</td>
            <td style="text-align:right; font-weight:bold; font-family:var(--font-mono);">${fmt(r.totalCost)} $</td>
          </tr>
          `).join('')}
          <tr class="subtotal-row">
            <td colspan="5">Total main-d\u2019\u0153uvre</td>
            <td style="text-align:right; font-family:var(--font-mono);">${fmt(totalLabor)} $</td>
          </tr>
        </tbody>
      </table>
    </div>`;

  return html;
}

/* ── main generator ──────────────────────────── */

export function generateEstimationHtml(data: EstimationData): string {
  const { measurements } = data;

  // Stats
  const nbMeasurements = measurements.filter((m) => !m.isDeduction).length;
  const nbDeductions = measurements.filter((m) => m.isDeduction).length;
  const nbProducts = new Set(measurements.filter((m) => !m.isDeduction && m.productId).map((m) => m.productId)).size;
  const pages = new Set(measurements.map((m) => m.pageNumber));

  // Build measurement reference section
  const measurementRefHtml = buildMeasurementRows(data);

  // Build labor summary section
  const laborRefHtml = buildLaborRows(data);

  // Build construction sections HTML
  const sectionsHtml = CONSTRUCTION_SECTIONS.map((section) => {
    const itemRows = section.items.map((item) => `
              <tr data-item="${item.id}" class="section-row">
                <td>
                  <div class="ed item-title">${escHtml(item.title)}</div>
                  <div class="ed item-desc">${escHtml(item.description)}</div>
                </td>
                <td style="text-align:center;">
                  <input type="number" class="num-input qty-input" value="1" min="0" step="1" oninput="recalcAll()">
                </td>
                <td style="text-align:center;">
                  <input type="number" class="num-input price-input" value="0" min="0" step="100" oninput="recalcAll()">
                </td>
                <td class="row-total" style="text-align:right; font-weight:bold; font-family:var(--font-mono);">0,00 $</td>
                <td class="cb-col" style="text-align:center;"><input type="checkbox" class="hide-cb" checked onchange="toggleRow(this)"></td>
              </tr>`).join('');

    return `
        <div class="section">
          <div class="section-title">${escHtml(section.name.toUpperCase())}</div>
          <table class="table section-table" data-section="${section.id}">
            <thead>
              <tr>
                <th style="width:46%">Description</th>
                <th style="width:12%; text-align:center">Quantité</th>
                <th style="width:16%; text-align:center">Prix unitaire ($)</th>
                <th style="width:16%; text-align:right">Total</th>
                <th style="width:10%; text-align:center" class="cb-col"><input type="checkbox" class="master-cb" checked onchange="toggleSection(this, '${section.id}')" title="Tout cocher/décocher"></th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
              <tr class="subtotal-row">
                <td colspan="3">Sous-total — ${escHtml(section.name)}</td>
                <td class="section-subtotal" data-section="${section.id}" style="text-align:right; font-family:var(--font-mono);">0,00 $</td>
                <td class="cb-col"></td>
              </tr>
            </tbody>
          </table>
        </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Soumission - ${escHtml(data.projectName || 'Métré PDF')} - ${today()}</title>
  <style>
    :root {
      --primary: #1F4E79;
      --primary-light: #7FB3DE;
      --primary-lighter: #D6E8F7;
      --primary-dark: #163a5c;
      --primary-darkest: #0f2b45;
      --bg: #F5FAFF;
      --card-bg: #EBF5FF;
      --white: #FFFFFF;
      --text: #1F2937;
      --text-light: #6B7280;
      --text-muted: #9CA3AF;
      --border: #E5E7EB;
      --border-light: #F3F4F6;
      --border-blue: #D6E8F7;
      --success: #22C55E;
      --danger: #EF4444;
      --radius: 0.5rem;
      --radius-lg: 0.75rem;
      --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
      --shadow-blue: 0 4px 12px rgba(31, 78, 121, 0.15);
      --font-base: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Arial, sans-serif;
      --font-mono: 'Courier New', 'Consolas', monospace;
      --gradient: linear-gradient(135deg, #1F4E79 0%, #0f2b45 100%);
      --gradient2: linear-gradient(135deg, #D6E8F7 0%, #FFFFFF 100%);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-base);
      font-size: 10px;
      line-height: 1.5;
      color: var(--text);
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
    }

    .container {
      max-width: 1100px;
      margin: 20px auto;
      padding: 0.5in;
      background: var(--white);
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border-light);
    }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid var(--primary);
      padding: 20px;
      background: var(--gradient2);
      border-radius: var(--radius);
      box-shadow: var(--shadow-blue);
      margin-bottom: 20px;
    }
    .logo-section .app-badge {
      display: inline-block;
      background: var(--gradient);
      color: white;
      padding: 6px 14px;
      border-radius: 0.375rem;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.05em;
    }
    .logo-section .app-sub {
      font-size: 9px;
      color: var(--text-light);
      margin-top: 4px;
      letter-spacing: 0.025em;
    }
    .company-info {
      text-align: right;
      font-size: 10px;
      line-height: 1.625;
      color: var(--text-light);
    }
    .company-name {
      font-weight: 700;
      font-size: 15px;
      margin-bottom: 4px;
      color: var(--primary-dark);
    }

    /* ── Title ── */
    .title {
      font-size: 24px;
      font-weight: 700;
      background: var(--gradient);
      color: white;
      margin: 0 0 10px 0;
      text-align: center;
      padding: 14px 20px;
      border-radius: var(--radius);
      box-shadow: 0 8px 24px rgba(31, 41, 55, 0.35);
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .subtitle {
      font-size: 11px;
      color: var(--text-light);
      margin-bottom: 20px;
      text-align: center;
    }
    .subtitle strong { color: var(--text); font-weight: 600; }

    /* ── Project info cards ── */
    .project-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 25px;
    }
    .info-section {
      padding: 12px;
      background: linear-gradient(135deg, #EBF5FF 0%, #FFFFFF 100%);
      border-radius: var(--radius);
      border: 1px solid var(--border-blue);
      box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.05);
    }
    .info-section h4 {
      font-weight: 700;
      font-size: 11px;
      margin-bottom: 8px;
      color: var(--primary-dark);
      padding-bottom: 4px;
      border-bottom: 2px solid var(--primary-lighter);
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .info-section p { font-size: 10px; margin-bottom: 3px; color: var(--text); }
    .info-section strong { color: var(--primary-dark); font-weight: 600; }

    /* ── Sections & Tables ── */
    .section { margin-bottom: 20px; }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: white;
      margin-bottom: 10px;
      padding: 10px 15px;
      background: var(--gradient);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }
    .table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      margin-bottom: 8px;
      background: white;
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.05);
      border: 1px solid var(--border);
    }
    .table th {
      padding: 10px 12px;
      text-align: left;
      font-weight: 700;
      font-size: 9px;
      background: var(--gradient);
      color: white;
      border: none;
      border-bottom: 2px solid var(--primary-darkest);
      letter-spacing: 0.025em;
      text-transform: uppercase;
    }
    .table td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-light);
      font-size: 10px;
      vertical-align: top;
    }
    .table tbody tr:hover td { background-color: #F0F7FF; }
    .table tbody tr:last-child td { border-bottom: none; }

    .item-title { font-weight: 600; color: var(--text); margin-bottom: 2px; }
    .item-desc {
      font-size: 9px;
      color: var(--text-light);
      font-style: italic;
      line-height: 1.5;
    }
    .subtotal-row td {
      background: var(--primary-lighter) !important;
      font-weight: 700;
      padding: 10px 12px;
      color: var(--primary-darkest);
      border-top: 2px solid var(--primary-light);
      border-bottom: none;
      letter-spacing: 0.025em;
    }

    /* ── Number inputs in tables ── */
    .num-input {
      width: 100%;
      max-width: 130px;
      padding: 6px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 10px;
      text-align: right;
      background: var(--white);
      color: var(--text);
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .num-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(31, 78, 121, 0.15);
    }
    .num-input:hover { border-color: var(--primary-light); }

    /* Row with amount > 0 */
    tr.has-amount td { background-color: #f0fdf4; }
    tr.has-amount:hover td { background-color: #dcfce7; }

    /* ── Summary box ── */
    .summary-box {
      margin-top: 30px;
      padding: 20px;
      background: linear-gradient(135deg, #EBF5FF 0%, #FFFFFF 100%);
      border-radius: var(--radius-lg);
      border: 2px solid var(--border-blue);
      border-left: 5px solid var(--primary);
      box-shadow: var(--shadow-blue);
    }
    .summary-box h4 {
      margin-bottom: 15px;
      font-size: 14px;
      color: var(--primary-dark);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      padding-bottom: 8px;
      border-bottom: 2px solid var(--primary-lighter);
    }
    .summary-table { width: 100%; font-size: 11px; border-collapse: separate; border-spacing: 0; }
    .summary-table td { padding: 8px 10px; }
    .summary-table tr:hover td { background-color: rgba(59, 130, 246, 0.04); }
    .summary-table .label {
      text-align: right;
      padding-right: 20px;
      color: var(--text-light);
      font-weight: 500;
    }
    .summary-table .value {
      text-align: right;
      font-weight: 700;
      font-family: var(--font-mono);
      width: 180px;
      color: var(--text);
    }
    .summary-table .total-row {
      border-top: 3px solid var(--primary);
      font-size: 14px;
      background: var(--primary-lighter);
      color: var(--primary-darkest);
    }
    .summary-table .total-row td { padding: 12px 10px; border-radius: 0.375rem; }

    .margin-input {
      width: 60px;
      padding: 4px 6px;
      border: 1px solid var(--border);
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 11px;
      text-align: right;
      outline: none;
    }
    .margin-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(31, 78, 121, 0.15);
    }

    /* ── Stats bar ── */
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 12px;
      margin-bottom: 25px;
    }
    .stat-card {
      text-align: center;
      padding: 12px 8px;
      background: linear-gradient(135deg, #EBF5FF 0%, #FFFFFF 100%);
      border-radius: var(--radius);
      border: 1px solid var(--border-blue);
    }
    .stat-value {
      font-size: 20px;
      font-weight: 700;
      color: var(--primary);
      font-family: var(--font-mono);
    }
    .stat-label {
      font-size: 9px;
      color: var(--text-light);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 2px;
    }

    /* ── Notes ── */
    .notes {
      margin-top: 20px;
      padding: 18px;
      background: linear-gradient(135deg, #EBF5FF 0%, #FFFFFF 100%);
      border: 1px solid var(--border-blue);
      border-left: 4px solid var(--primary);
      border-radius: var(--radius);
    }
    .notes h4 {
      font-weight: 700;
      margin-bottom: 12px;
      color: var(--primary-dark);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      padding-bottom: 8px;
      border-bottom: 2px solid var(--primary-lighter);
    }
    .notes ul { margin-left: 20px; list-style-type: none; }
    .notes li {
      margin-bottom: 6px;
      font-size: 9px;
      line-height: 1.625;
      color: var(--text-light);
      position: relative;
      padding-left: 14px;
    }
    .notes li::before {
      content: '';
      position: absolute;
      left: 0; top: 5px;
      width: 5px; height: 5px;
      background: var(--primary);
      border-radius: 50%;
    }
    .notes li strong { color: var(--text); font-weight: 600; }

    /* ── Signatures ── */
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-top: 30px;
      padding: 20px;
    }
    .sig-block {
      border-top: 2px solid var(--primary);
      padding-top: 10px;
    }
    .sig-block .sig-label {
      font-size: 10px;
      font-weight: 600;
      color: var(--primary-dark);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .sig-block .sig-line {
      margin-top: 40px;
      border-bottom: 1px solid var(--text-muted);
      padding-bottom: 4px;
      font-size: 9px;
      color: var(--text-muted);
    }

    /* ── Footer ── */
    .footer {
      margin-top: 30px;
      text-align: center;
      font-size: 9px;
      color: var(--text-light);
      border-top: 3px solid var(--primary);
      background: var(--gradient2);
      padding: 20px;
      border-radius: var(--radius);
    }
    .footer strong { color: var(--text); }

    /* ── Toolbar buttons ── */
    .toolbar {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9999;
      display: flex;
      gap: 8px;
    }
    .tb-btn {
      padding: 10px 18px;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      transition: all 0.2s;
      color: white;
    }
    .tb-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25); }
    .tb-btn.print { background: linear-gradient(135deg, #059669, #047857); }
    .tb-btn.edit { background: linear-gradient(135deg, #1F4E79, #163a5c); }
    .tb-btn.edit.active { background: linear-gradient(135deg, #10b981, #059669); }

    /* ── Editable mode ── */
    .ed { border-radius: 2px; transition: outline 0.15s, background-color 0.15s; }
    .edit-active .ed {
      outline: 1px dashed var(--primary);
      padding: 2px 4px;
      background: rgba(31, 78, 121, 0.03);
    }
    .edit-active .ed:focus {
      outline: 2px solid var(--primary);
      background: rgba(31, 78, 121, 0.06);
    }

    /* ── Checkboxes ── */
    .hide-cb, .master-cb {
      cursor: pointer;
      transform: scale(1.3);
      accent-color: var(--primary);
    }
    .master-cb { transform: scale(1.4); }
    .section-row.row-hidden {
      display: none;
    }

    /* ── Item count badge ── */
    .item-count {
      display: inline-block;
      background: var(--primary);
      color: white;
      font-size: 9px;
      padding: 2px 8px;
      border-radius: 10px;
      margin-left: 8px;
      font-weight: 600;
    }

    /* ── Print ── */
    @media print {
      body { background: white; }
      .container { margin: 0; padding: 0.3in; max-width: 8.5in; box-shadow: none; border: none; }
      .toolbar { display: none !important; }
      .summary-box, .notes, .signatures { page-break-inside: avoid; }
      .section { page-break-inside: avoid; }
      .num-input {
        border: none;
        background: transparent;
        padding: 0;
        font-weight: 600;
      }
      .margin-input {
        border: none;
        background: transparent;
        padding: 0;
        font-weight: 600;
      }
      .table { overflow: visible; }
      .cb-col, .hide-cb, .master-cb { display: none !important; }
      .section-row.row-hidden { display: none !important; }
      .info-section:hover { box-shadow: none; transform: none; }
    }
  </style>
</head>
<body>
  <!-- Toolbar -->
  <div class="toolbar">
    <button class="tb-btn print" onclick="window.print()">Imprimer / PDF</button>
    <button class="tb-btn edit" id="editBtn" onclick="toggleEdit()">Activer Edition</button>
  </div>

  <div class="container" id="doc">
    <!-- Header -->
    <div class="header">
      <div class="logo-section">
        <div class="app-badge">CONSTRUCTO AI</div>
        <div class="app-sub">Soumission générée par Métré PDF — Take Off Gratuit</div>
      </div>
      <div class="company-info">
        <div class="company-name ed">Constructo AI Inc.</div>
        <div class="ed">1760 rue Jacques-Cartier Sud</div>
        <div class="ed">Farnham (Québec) J2N 1Y8</div>
        <div class="ed">Tél: 514-820-1972</div>
        <div class="ed">info@constructoai.ca | www.constructoai.ca</div>
        <div style="margin-top:3px; font-size:9px;" class="ed">RBQ: ____-____-__ | NEQ: __________</div>
      </div>
    </div>

    <!-- Title -->
    <h1 class="title">SOUMISSION DE CONSTRUCTION</h1>
    <div class="subtitle">
      <strong>N° de référence:</strong> <span class="ed">SOUM-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-001</span>
      &nbsp;&nbsp;|&nbsp;&nbsp;
      <strong>Date:</strong> ${today()}
      &nbsp;&nbsp;|&nbsp;&nbsp;
      <strong>Validité:</strong> <span class="ed">30 jours</span>
    </div>

    <!-- Project info -->
    <div class="project-info">
      <div class="info-section">
        <h4>CLIENT</h4>
        <p><strong>Nom:</strong> <span class="ed">${escHtml(data.clientName || '[Nom du client]')}</span></p>
        <p><strong>Adresse:</strong> <span class="ed">${escHtml(data.clientAddress || '[Adresse complète]')}</span></p>
        <p><strong>Ville:</strong> <span class="ed">${escHtml(data.clientCity || '[Ville, Province, Code postal]')}</span></p>
        <p><strong>Téléphone:</strong> <span class="ed">${escHtml(data.clientPhone || '[Téléphone]')}</span></p>
        <p><strong>Courriel:</strong> <span class="ed">${escHtml(data.clientEmail || '[Courriel]')}</span></p>
      </div>
      <div class="info-section">
        <h4>PROJET</h4>
        <p><strong>Nom:</strong> <span class="ed">${escHtml(data.projectName || '[Nom du projet]')}</span></p>
        <p><strong>Adresse:</strong> <span class="ed">${escHtml(data.projectAddress || '[Adresse du chantier]')}</span></p>
        <p><strong>Type:</strong> <span class="ed">${escHtml(data.projectType || '[Résidentiel / Commercial / Industriel]')}</span></p>
        <p><strong>Superficie:</strong> <span class="ed">${escHtml(data.projectArea || '[Superficie approximative]')}</span></p>
      </div>
      <div class="info-section">
        <h4>MÉTRÉ (TAKE OFF)</h4>
        <p><strong>Mesures:</strong> ${nbMeasurements}${nbDeductions > 0 ? ` (+ ${nbDeductions} déductions)` : ''}</p>
        <p><strong>Produits liés:</strong> ${nbProducts}</p>
        <p><strong>Pages analysées:</strong> ${pages.size}</p>
        <p><strong>Groupes:</strong> ${data.groups.length > 0 ? escHtml(data.groups.join(', ')) : 'Aucun'}</p>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats-bar">
      <div class="stat-card">
        <div class="stat-value">${CONSTRUCTION_SECTIONS.reduce((s, sec) => s + sec.items.length, 0)}</div>
        <div class="stat-label">Items construction</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${CONSTRUCTION_SECTIONS.length}</div>
        <div class="stat-label">Sections</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${nbMeasurements}</div>
        <div class="stat-label">Mesures Take Off</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="nb-active">0</div>
        <div class="stat-label">Items actifs (> 0$)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="total-header">0,00 $</div>
        <div class="stat-label">Total avant marges</div>
      </div>
    </div>

    <!-- Construction Sections -->
    ${sectionsHtml}

    <!-- Measurement reference -->
    ${measurementRefHtml}

    <!-- Labor summary (main-d'oeuvre CCQ) -->
    ${laborRefHtml}

    <!-- Financial Summary -->
    <div class="summary-box">
      <h4>RÉCAPITULATIF FINANCIER</h4>
      <table class="summary-table">
        ${CONSTRUCTION_SECTIONS.map((s) => `
        <tr>
          <td class="label">${escHtml(s.name)}:</td>
          <td class="value section-recap" data-section="${s.id}">0,00 $</td>
        </tr>`).join('')}
        <tr style="border-top: 2px solid var(--border);">
          <td class="label" style="font-weight:700; color:var(--text);">TOTAL DES TRAVAUX:</td>
          <td class="value" style="font-weight:700; color:var(--primary);" id="sum-travaux">0,00 $</td>
        </tr>
        <tr>
          <td class="label">Administration <input type="number" class="margin-input" id="admin-pct" value="3" min="0" max="100" step="0.5" oninput="recalcAll()"> %:</td>
          <td class="value" id="admin-amt">0,00 $</td>
        </tr>
        <tr>
          <td class="label">Contingences <input type="number" class="margin-input" id="contingency-pct" value="12" min="0" max="100" step="0.5" oninput="recalcAll()"> %:</td>
          <td class="value" id="contingency-amt">0,00 $</td>
        </tr>
        <tr>
          <td class="label">Profit <input type="number" class="margin-input" id="profit-pct" value="15" min="0" max="100" step="0.5" oninput="recalcAll()"> %:</td>
          <td class="value" id="profit-amt">0,00 $</td>
        </tr>
        <tr style="border-top: 2px solid var(--border);">
          <td class="label" style="font-weight:700; color:var(--text);">SOUS-TOTAL AVANT TAXES:</td>
          <td class="value" style="font-weight:700;" id="subtotal-bt">0,00 $</td>
        </tr>
        <tr>
          <td class="label">TPS (5%):</td>
          <td class="value" id="tps-amt">0,00 $</td>
        </tr>
        <tr>
          <td class="label">TVQ (9,975%):</td>
          <td class="value" id="tvq-amt">0,00 $</td>
        </tr>
        <tr class="total-row">
          <td class="label"><strong>TOTAL AVEC TAXES:</strong></td>
          <td class="value"><strong id="total-final">0,00 $</strong></td>
        </tr>
      </table>
    </div>

    <!-- Notes -->
    <div class="notes">
      <h4>NOTES ET CONDITIONS</h4>
      <ul>
        <li><strong>Validité:</strong> <span class="ed">Cette soumission est valide pour 30 jours à compter de la date d'émission.</span></li>
        <li><strong>Paiements:</strong> <span class="ed">Selon l'avancement des travaux. Dépôt de 10% à la signature du contrat.</span></li>
        <li><strong>Délai:</strong> <span class="ed">Les travaux débuteront dans un délai de [X] semaines suivant l'acceptation.</span></li>
        <li><strong>Durée estimée:</strong> <span class="ed">[X] semaines selon les conditions météorologiques et la disponibilité des matériaux.</span></li>
        <li><strong>Garantie:</strong> <span class="ed">Garantie de 1 an sur la main-d'oeuvre. Garanties fabricant sur les matériaux.</span></li>
        <li><strong>Permis:</strong> <span class="ed">Les frais de permis sont inclus dans la section 0.0. Le client est responsable de fournir les plans.</span></li>
        <li><strong>Exclusions:</strong> <span class="ed">Sauf indication contraire, cette soumission exclut: mobilier, électroménagers, décoration intérieure.</span></li>
        <li><strong>Taxes:</strong> TPS 5% et TVQ 9,975% calculées sur le sous-total incluant les frais d'administration, contingences et profit.</li>
        <li><strong>RBQ:</strong> <span class="ed">Tous les travaux sont effectués par des entrepreneurs licenciés RBQ.</span></li>
      </ul>
    </div>

    <!-- Signatures -->
    <div class="signatures">
      <div class="sig-block">
        <div class="sig-label">ENTREPRENEUR</div>
        <div class="sig-line ed">Nom: ___________________________</div>
        <div class="sig-line ed">Signature: ______________________</div>
        <div class="sig-line">Date: ___________________________</div>
      </div>
      <div class="sig-block">
        <div class="sig-label">CLIENT</div>
        <div class="sig-line ed">Nom: ___________________________</div>
        <div class="sig-line ed">Signature: ______________________</div>
        <div class="sig-line">Date: ___________________________</div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p><strong>Soumission générée par Métré PDF — Constructo AI</strong></p>
      <p style="margin-top:10px;">Constructo AI Inc. | info@constructoai.ca | www.constructoai.ca</p>
      <p style="margin-top:15px; font-size:8px; color:#888;">
        Ce document est une soumission basée sur les mesures prises sur plans PDF et les items de construction standardisés du Québec.<br>
        Les quantités et prix doivent être validés avant engagement. Toute modification doit faire l'objet d'un avenant écrit.<br>
        &copy; ${new Date().getFullYear()} Constructo AI Inc. — Tous droits réservés.
      </p>
    </div>
  </div>

  <!-- ── JavaScript ── -->
  <script>
    /* ── Format number to FR-CA ── */
    function fmtNum(n) {
      if (!isFinite(n)) return '0,00';
      return (n ?? 0).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ').replace('.', ',');
    }

    /* ── Toggle row visibility ── */
    function toggleRow(checkbox) {
      var row = checkbox.closest('.section-row');
      if (!row) return;
      row.classList.toggle('row-hidden', !checkbox.checked);
      recalcAll();
    }

    /* ── Toggle all rows in a section ── */
    function toggleSection(masterCb, sectionId) {
      var table = document.querySelector('.section-table[data-section="' + sectionId + '"]');
      if (!table) return;
      var cbs = table.querySelectorAll('.hide-cb');
      cbs.forEach(function(cb) {
        cb.checked = masterCb.checked;
        var row = cb.closest('.section-row');
        if (row) row.classList.toggle('row-hidden', !masterCb.checked);
      });
      recalcAll();
    }

    /* ── Recalculate everything ── */
    function recalcAll() {
      let grandTotal = 0;
      let nbActive = 0;

      document.querySelectorAll('.section-table').forEach(function(table) {
        let sectionTotal = 0;
        const sectionId = table.getAttribute('data-section');

        table.querySelectorAll('tr[data-item]').forEach(function(row) {
          const qtyInput = row.querySelector('.qty-input');
          const priceInput = row.querySelector('.price-input');
          const totalCell = row.querySelector('.row-total');
          const isHidden = row.classList.contains('row-hidden');
          const qty = parseFloat(qtyInput.value) || 0;
          const price = parseFloat(priceInput.value) || 0;
          const total = qty * price;
          totalCell.textContent = fmtNum(total) + ' $';

          if (!isHidden && total > 0) {
            row.classList.add('has-amount');
            nbActive++;
          } else {
            row.classList.remove('has-amount');
          }
          if (!isHidden) sectionTotal += total;
        });

        // Update section subtotals
        var st = document.querySelector('.section-subtotal[data-section="' + sectionId + '"]');
        if (st) st.textContent = fmtNum(sectionTotal) + ' $';
        var sr = document.querySelector('.section-recap[data-section="' + sectionId + '"]');
        if (sr) sr.textContent = fmtNum(sectionTotal) + ' $';

        grandTotal += sectionTotal;
      });

      // Margins
      var adminPct = parseFloat(document.getElementById('admin-pct').value) || 0;
      var contPct = parseFloat(document.getElementById('contingency-pct').value) || 0;
      var profitPct = parseFloat(document.getElementById('profit-pct').value) || 0;

      var adminAmt = grandTotal * adminPct / 100;
      var contAmt = grandTotal * contPct / 100;
      var profitAmt = grandTotal * profitPct / 100;
      var subtotalBT = grandTotal + adminAmt + contAmt + profitAmt;
      var tps = subtotalBT * 0.05;
      var tvq = subtotalBT * 0.09975;
      var totalFinal = subtotalBT + tps + tvq;

      // Update all summary fields
      document.getElementById('sum-travaux').textContent = fmtNum(grandTotal) + ' $';
      document.getElementById('admin-amt').textContent = fmtNum(adminAmt) + ' $';
      document.getElementById('contingency-amt').textContent = fmtNum(contAmt) + ' $';
      document.getElementById('profit-amt').textContent = fmtNum(profitAmt) + ' $';
      document.getElementById('subtotal-bt').textContent = fmtNum(subtotalBT) + ' $';
      document.getElementById('tps-amt').textContent = fmtNum(tps) + ' $';
      document.getElementById('tvq-amt').textContent = fmtNum(tvq) + ' $';
      document.getElementById('total-final').textContent = fmtNum(totalFinal) + ' $';

      // Header stats
      document.getElementById('nb-active').textContent = nbActive;
      document.getElementById('total-header').textContent = fmtNum(grandTotal) + ' $';
    }

    /* ── Toggle edit mode for text fields ── */
    var isEditMode = false;
    function toggleEdit() {
      isEditMode = !isEditMode;
      var btn = document.getElementById('editBtn');
      var doc = document.getElementById('doc');
      var els = doc.querySelectorAll('.ed');
      if (isEditMode) {
        btn.textContent = 'Verrouiller';
        btn.classList.add('active');
        doc.classList.add('edit-active');
        els.forEach(function(el) { el.contentEditable = 'true'; });
      } else {
        btn.textContent = 'Activer Edition';
        btn.classList.remove('active');
        doc.classList.remove('edit-active');
        els.forEach(function(el) { el.contentEditable = 'false'; });
      }
    }

    /* ── Initial calc ── */
    recalcAll();
  </script>
</body>
</html>`;
}

/** Open the HTML estimation in a new browser tab */
export function openEstimationInNewTab(data: EstimationData): void {
  const html = generateEstimationHtml(data);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Download the HTML estimation as a file */
export function downloadEstimationHtml(data: EstimationData): void {
  const html = generateEstimationHtml(data);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `soumission-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
