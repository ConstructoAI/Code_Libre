/**
 * pdfPro.ts
 * Helper PDF professionnel multi-pages inspire de Wall Builder Pro.
 *
 * Genere des plans techniques structures (header, vue SVG en PNG, cotations,
 * tableaux pieces, notes, footer) reutilisables pour tous les calculateurs
 * Constructo AI (Murs, Plancher, Toiture, Revetement).
 *
 * Dependances : jspdf ^4.2.0 et jspdf-autotable ^5.0.7 (deja installes).
 * Aucun ajout de dependance externe.
 *
 * Unites internes : points PDF (72 pt = 1 pouce). Format par defaut : Lettre
 * 8.5 x 11 po = 612 x 792 pt. Les cotes/longueurs metiers sont fournies en
 * pouces (in) et formatees via formatFraction / pieds-pouces.
 *
 * Note : ce helper NE MODIFIE PAS le composant appelant. Il expose une API
 * declarative (PdfProDocument -> generatePdfPro -> jsPDF) et quelques helpers
 * bas-niveau (drawPdfHeader, drawPdfFooter, drawTopDimensions, drawSvgView,
 * drawTables) ainsi que des utilitaires (svgElementToPngDataUrl,
 * formatFraction, calculateDiagonalSquare).
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ============================================================================
// CONSTANTES DE LAYOUT (en points PDF, 1pt = 1/72 inch)
// ============================================================================

/** Format Lettre US en points (8.5 x 11 po). */
export const PAGE_LETTER_PT = { width: 612, height: 792 } as const;

/** Marges par defaut : gauche/droite 36pt (0.5"), haut/bas 54pt (0.75"). */
export const PAGE_MARGINS_PT = { left: 36, right: 36, top: 54, bottom: 54 } as const;

/** Hauteur reservee au header (titre projet, page X/Y, meta, separateur). */
export const HEADER_HEIGHT_PT = 90;

/** Hauteur reservee au footer (mention + numero page + ligne). */
export const FOOTER_HEIGHT_PT = 36;

/** Hauteur reservee aux cotations top (fleches + fractions verticales). */
export const TOP_DIMENSIONS_HEIGHT_PT = 38;

/** Palette de couleurs neutres (compatible mode impression). */
const COLORS = {
  textDark: [15, 23, 42] as [number, number, number],
  textMid: [55, 65, 81] as [number, number, number],
  textLight: [120, 130, 145] as [number, number, number],
  border: [200, 210, 220] as [number, number, number],
  headerFill: [55, 65, 81] as [number, number, number],
  altRow: [243, 244, 246] as [number, number, number],
  accent: [37, 99, 235] as [number, number, number],
};

// ============================================================================
// TYPES PUBLICS
// ============================================================================

/** Configuration globale du document PDF. */
export interface PdfProConfig {
  projectName: string;
  projectAddress?: string;
  clientName?: string;
  pageTitle: string;
  pageSubtitle?: string;
  date?: string;
  companyName?: string;
  companyAddress?: string;
  scale?: string;
  pageNumber: number;
  totalPages: number;
}

/** Une colonne d'un tableau pieces. */
export interface PdfProColumn {
  header: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
}

/** Un tableau pieces (autoTable) avec titre. */
export interface PdfProTable {
  title: string;
  columns: PdfProColumn[];
  rows: (string | number)[][];
  headStyles?: Record<string, unknown>;
  bodyStyles?: Record<string, unknown>;
}

/** Une vue SVG rendue en PNG, prete a etre inseree dans le PDF. */
export interface PdfProView {
  pngDataUrl: string;
  widthPt: number;
  heightPt: number;
  caption?: string;
}

/** Cotations top : fractions au-dessus de chaque montant. */
export interface PdfProTopDimensions {
  fractions: string[];
  cumulative?: boolean;
}

/** Une page du document. */
export interface PdfProPage {
  id: string;
  title: string;
  view?: PdfProView;
  topDimensions?: PdfProTopDimensions;
  tables: PdfProTable[];
  notes?: string[];
  diagonalCarree?: string;
}

/** Document complet. */
export interface PdfProDocument {
  config: PdfProConfig;
  pages: PdfProPage[];
}

/** Piece generique pour construire un tableau pieces. */
export interface GenericPiece {
  qty: number;
  size: string;
  lengthIn: number | string;
  utilisation: string;
}

/** Panneau generique pour construire un tableau revetement. */
export interface GenericPanel {
  qty: number;
  size: string;
  thickness: string;
  widthIn?: number;
  lengthIn?: number;
}

// ============================================================================
// UTILITAIRES MESURE / FORMAT
// ============================================================================

/**
 * Convertit un decimal en pouces en fraction au 16eme : 92.625 -> "92 5/8".
 * precision : 16 (defaut), 32 ou 64 — denominateur max.
 * withFeet : si true et value > 12, formate en pieds-pouces "11'8 5/8".
 */
export function formatFraction(
  decimalIn: number,
  precision: 16 | 32 | 64 = 16,
  withFeet: boolean = false,
): string {
  if (decimalIn == null || isNaN(decimalIn) || !isFinite(decimalIn)) return '0';
  const sign = decimalIn < 0 ? '-' : '';
  const abs = Math.abs(decimalIn);

  if (withFeet && abs >= 12) {
    const feet = Math.floor(abs / 12);
    const rem = abs - feet * 12;
    const remFrac = formatFraction(rem, precision, false);
    if (remFrac === '0' || remFrac === '0"') return `${sign}${feet}'`;
    return `${sign}${feet}'${remFrac.replace(/"$/, '')}`;
  }

  const whole = Math.floor(abs);
  const frac = abs - whole;
  const units = Math.round(frac * precision);
  if (units === 0) return `${sign}${whole}`;
  if (units === precision) return `${sign}${whole + 1}`;
  let num = units;
  let den = precision;
  while (num % 2 === 0 && den % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  return whole === 0 ? `${sign}${num}/${den}` : `${sign}${whole} ${num}/${den}`;
}

/**
 * Calcule la diagonale carree (verification equerre) en format
 * pieds-pouces fraction 16e : sqrt(L^2 + H^2).
 * Exemple : 144 in x 96 in -> 173.06 in -> "14'5 1/16\"".
 */
export function calculateDiagonalSquare(lengthIn: number, heightIn: number): string {
  if (lengthIn <= 0 || heightIn <= 0) return '0';
  const diag = Math.sqrt(lengthIn * lengthIn + heightIn * heightIn);
  return `${formatFraction(diag, 16, true)}"`;
}

/**
 * Convertit un SVGSVGElement en data URL PNG via canvas.
 * scale : facteur de sur-echantillonnage pour crisper le rendu (defaut 2).
 * Gere xmlns manquants et CORS basique (data:URI safe).
 */
export function svgElementToPngDataUrl(
  svgEl: SVGSVGElement,
  scale: number = 2,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const cloned = svgEl.cloneNode(true) as SVGSVGElement;
      if (!cloned.getAttribute('xmlns')) {
        cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      if (!cloned.getAttribute('xmlns:xlink')) {
        cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      }
      const bbox = svgEl.getBoundingClientRect();
      const baseW = svgEl.viewBox?.baseVal?.width || bbox.width || 800;
      const baseH = svgEl.viewBox?.baseVal?.height || bbox.height || 600;
      const targetW = Math.max(1, Math.round(baseW * scale));
      const targetH = Math.max(1, Math.round(baseH * scale));

      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(cloned);
      const svg64 =
        typeof window !== 'undefined' && window.btoa
          ? window.btoa(unescape(encodeURIComponent(svgStr)))
          : '';
      const dataUri = `data:image/svg+xml;base64,${svg64}`;

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context indisponible'));
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Echec toDataURL'));
        }
      };
      img.onerror = () => reject(new Error('Echec chargement SVG dans Image'));
      img.src = dataUri;
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Erreur conversion SVG'));
    }
  });
}

// ============================================================================
// HELPERS DE BAS NIVEAU (HEADER / FOOTER / VIEW / DIMS / TABLES)
// ============================================================================

/**
 * Dessine le header de page (titre, projet, page X/Y, scale, ligne).
 * Retourne la coordonnee Y juste apres le header (debut de la zone de contenu).
 */
export function drawPdfHeader(pdf: jsPDF, config: PdfProConfig, pageIdx: number): number {
  const pageW = pdf.internal.pageSize.getWidth();
  const top = PAGE_MARGINS_PT.top;
  const left = PAGE_MARGINS_PT.left;
  const right = pageW - PAGE_MARGINS_PT.right;

  // Ligne 1 : entreprise (gauche), titre page (centre), page X/Y (droite)
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(...COLORS.textDark);
  const company = config.companyName || 'Constructo AI';
  pdf.text(company, left, top);

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text(config.pageTitle, pageW / 2, top, { align: 'center' });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...COLORS.textMid);
  pdf.text(`Page ${config.pageNumber} de ${config.totalPages}`, right, top, {
    align: 'right',
  });

  // Ligne 2 : sous-titre + projet/client/date/scale
  const y2 = top + 14;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...COLORS.textMid);

  const leftMeta: string[] = [];
  leftMeta.push(`Projet : ${config.projectName}`);
  if (config.clientName) leftMeta.push(`Client : ${config.clientName}`);
  if (config.projectAddress) leftMeta.push(config.projectAddress);
  pdf.text(leftMeta.join('   |   '), left, y2);

  const rightMeta: string[] = [];
  if (config.date) rightMeta.push(config.date);
  if (config.scale) rightMeta.push(`Echelle ${config.scale}`);
  if (rightMeta.length > 0) {
    pdf.text(rightMeta.join('   |   '), right, y2, { align: 'right' });
  }

  // Ligne 3 : sous-titre page (optionnel)
  let y3 = y2;
  if (config.pageSubtitle) {
    y3 = y2 + 12;
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(9);
    pdf.setTextColor(...COLORS.textMid);
    pdf.text(config.pageSubtitle, left, y3);
  }

  // Ligne separatrice
  const sepY = y3 + 8;
  pdf.setDrawColor(...COLORS.border);
  pdf.setLineWidth(0.5);
  pdf.line(left, sepY, right, sepY);

  // Indice de page (utile pour debug multi-pages)
  void pageIdx;

  return sepY + 8;
}

/**
 * Dessine le footer de page (mention + page X/Y + date) avec ligne separatrice.
 */
export function drawPdfFooter(pdf: jsPDF, config: PdfProConfig, pageIdx: number): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const left = PAGE_MARGINS_PT.left;
  const right = pageW - PAGE_MARGINS_PT.right;
  const footerY = pageH - PAGE_MARGINS_PT.bottom + 18;

  // Ligne separatrice
  pdf.setDrawColor(...COLORS.border);
  pdf.setLineWidth(0.5);
  pdf.line(left, footerY - 8, right, footerY - 8);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...COLORS.textLight);

  const company = config.companyName || 'Constructo AI';
  pdf.text(`${company} ERP - constructoai.ca`, left, footerY);

  pdf.text(`Page ${config.pageNumber} de ${config.totalPages}`, pageW / 2, footerY, {
    align: 'center',
  });

  const gen = config.date
    ? `Genere le ${config.date}`
    : `Genere le ${new Date().toLocaleDateString('fr-CA')}`;
  pdf.text(gen, right, footerY, { align: 'right' });

  void pageIdx;
}

/**
 * Dessine les cotations top : petites lignes verticales + fraction
 * tournee 270deg au-dessus de chaque montant. Repartit les graduations
 * de facon equidistante sur totalWidthPt.
 */
export function drawTopDimensions(
  pdf: jsPDF,
  x: number,
  y: number,
  fractions: string[],
  totalWidthPt: number,
): void {
  if (!fractions || fractions.length === 0) return;

  const n = fractions.length;
  const step = totalWidthPt / Math.max(1, n);
  const tickH = 8; // hauteur de la mini-fleche
  const textGap = 4; // gap entre fleche et texte
  const baselineY = y + TOP_DIMENSIONS_HEIGHT_PT - 2; // ligne basse (haut du plan)

  pdf.setDrawColor(...COLORS.textDark);
  pdf.setLineWidth(0.4);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7);
  pdf.setTextColor(...COLORS.textDark);

  // Ligne horizontale de reference (juste au-dessus du plan)
  pdf.line(x, baselineY, x + totalWidthPt, baselineY);

  for (let i = 0; i < n; i++) {
    const cx = x + step * (i + 0.5);
    // Mini-tick vertical pointant vers le bas
    pdf.line(cx, baselineY - tickH, cx, baselineY);
    // Petite chevrette pour evoquer la fleche
    pdf.line(cx - 2, baselineY - 3, cx, baselineY);
    pdf.line(cx + 2, baselineY - 3, cx, baselineY);

    // Texte fraction tourne 270deg au-dessus
    const txt = fractions[i] ?? '';
    if (txt) {
      pdf.text(txt, cx + 2.2, baselineY - tickH - textGap, {
        angle: 90,
        baseline: 'bottom',
      });
    }
  }
}

/**
 * Insere la vue SVG (deja en PNG) dans le PDF en preservant le ratio,
 * dans la limite maxWidthPt x maxHeightPt, avec border + caption.
 * Retourne la coordonnee Y juste sous la vue.
 */
export function drawSvgView(
  pdf: jsPDF,
  view: PdfProView | undefined,
  x: number,
  y: number,
  maxWidthPt: number,
  maxHeightPt: number,
): number {
  if (!view || !view.pngDataUrl) return y;

  const ratio = view.widthPt > 0 ? view.heightPt / view.widthPt : 1;
  let w = Math.min(view.widthPt, maxWidthPt);
  let h = w * ratio;
  if (h > maxHeightPt) {
    h = maxHeightPt;
    w = h / Math.max(ratio, 0.0001);
  }

  // Centrage horizontal dans la zone disponible
  const drawX = x + (maxWidthPt - w) / 2;
  pdf.addImage(view.pngDataUrl, 'PNG', drawX, y, w, h);

  // Border leger
  pdf.setDrawColor(...COLORS.border);
  pdf.setLineWidth(0.5);
  pdf.rect(drawX, y, w, h);

  let nextY = y + h + 4;
  if (view.caption) {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(8);
    pdf.setTextColor(...COLORS.textLight);
    pdf.text(view.caption, x + maxWidthPt / 2, nextY + 6, { align: 'center' });
    nextY += 12;
  }
  return nextY;
}

/**
 * Empile les tableaux PdfProTable verticalement avec un gap de 16pt.
 * Retourne le Y final apres tous les tableaux.
 */
export function drawTables(
  pdf: jsPDF,
  tables: PdfProTable[],
  x: number,
  y: number,
  maxWidthPt: number,
): number {
  if (!tables || tables.length === 0) return y;

  let cursorY = y;
  for (const table of tables) {
    // Titre du tableau
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...COLORS.textDark);
    pdf.text(table.title, x, cursorY + 10);
    cursorY += 14;

    const head = [table.columns.map((c) => c.header)];
    const body = table.rows.map((row) => row.map((cell) => String(cell ?? '')));

    const columnStyles: Record<number, Record<string, unknown>> = {};
    table.columns.forEach((c, idx) => {
      const s: Record<string, unknown> = {};
      if (typeof c.width === 'number') s.cellWidth = c.width;
      if (c.align) s.halign = c.align;
      columnStyles[idx] = s;
    });

    autoTable(pdf, {
      startY: cursorY,
      head,
      body,
      margin: { left: x, right: PAGE_MARGINS_PT.right },
      tableWidth: maxWidthPt,
      styles: { fontSize: 8, cellPadding: 3, textColor: COLORS.textDark },
      headStyles: {
        fillColor: COLORS.headerFill,
        textColor: 255,
        fontSize: 9,
        fontStyle: 'bold',
        halign: 'center',
        ...(table.headStyles || {}),
      },
      bodyStyles: { fontSize: 8, cellPadding: 3, ...(table.bodyStyles || {}) },
      alternateRowStyles: { fillColor: COLORS.altRow },
      columnStyles,
      theme: 'grid',
    });

    // Recuperer la position finale d'autoTable
    type AutoTableJsPDF = jsPDF & { lastAutoTable?: { finalY: number } };
    const finalY = (pdf as AutoTableJsPDF).lastAutoTable?.finalY ?? cursorY + 30;
    cursorY = finalY + 16; // gap entre tableaux
  }
  return cursorY;
}

/**
 * Dessine les notes (italique 8pt) en bas de page, juste au-dessus du footer.
 * Retourne la coordonnee Y apres les notes.
 */
function drawNotes(pdf: jsPDF, notes: string[] | undefined, x: number, y: number): number {
  if (!notes || notes.length === 0) return y;
  const pageW = pdf.internal.pageSize.getWidth();
  const maxW = pageW - PAGE_MARGINS_PT.right - x;

  pdf.setFont('helvetica', 'italic');
  pdf.setFontSize(8);
  pdf.setTextColor(...COLORS.textMid);

  let cursorY = y + 4;
  for (const note of notes) {
    const lines = pdf.splitTextToSize(`NOTE: ${note}`, maxW);
    pdf.text(lines, x, cursorY);
    cursorY += lines.length * 10;
  }
  return cursorY;
}

// ============================================================================
// CONSTRUCTEURS DE TABLEAUX (helpers metiers)
// ============================================================================

/**
 * Construit un PdfProTable a partir d'une liste de pieces generiques.
 * Colonnes : QTE / TAILLE / LONGUEUR / UTILISER.
 */
export function buildPiecesTable(pieces: GenericPiece[], title: string): PdfProTable {
  const columns: PdfProColumn[] = [
    { header: 'QTE', width: 40, align: 'center' },
    { header: 'TAILLE', width: 60, align: 'center' },
    { header: 'LONGUEUR', width: 90, align: 'right' },
    { header: 'UTILISER', align: 'left' },
  ];
  const rows = pieces.map((p) => {
    const lengthStr =
      typeof p.lengthIn === 'string' ? p.lengthIn : `${formatFraction(p.lengthIn, 16, true)}"`;
    return [String(p.qty), p.size, lengthStr, p.utilisation];
  });
  return { title, columns, rows };
}

/**
 * Construit un PdfProTable pour le revetement (plywood / OSB).
 * Colonnes : QTE / TAILLE / EPAISSEUR.
 */
export function buildSheathingTable(panels: GenericPanel[], title: string): PdfProTable {
  const columns: PdfProColumn[] = [
    { header: 'QTE', width: 40, align: 'center' },
    { header: 'TAILLE', width: 80, align: 'center' },
    { header: 'EPAISSEUR', width: 80, align: 'center' },
    { header: 'DIMENSIONS', align: 'left' },
  ];
  const rows = panels.map((p) => {
    const dims: string[] = [];
    if (p.widthIn) dims.push(`L ${formatFraction(p.widthIn, 16, true)}"`);
    if (p.lengthIn) dims.push(`H ${formatFraction(p.lengthIn, 16, true)}"`);
    return [String(p.qty), p.size, p.thickness, dims.join(' x ') || 'Standard'];
  });
  return { title, columns, rows };
}

// ============================================================================
// FONCTION PRINCIPALE : generatePdfPro
// ============================================================================

/**
 * Genere un jsPDF complet a partir d'un PdfProDocument.
 * Une page PDF par PdfProPage. Le caller appelle .save() ou .output('blob').
 */
export function generatePdfPro(docDef: PdfProDocument): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const contentLeft = PAGE_MARGINS_PT.left;
  const contentRight = pageW - PAGE_MARGINS_PT.right;
  const contentTop = PAGE_MARGINS_PT.top;
  const contentBottom = pageH - PAGE_MARGINS_PT.bottom;
  const contentWidth = contentRight - contentLeft;

  const totalPages = docDef.pages.length || 1;

  docDef.pages.forEach((page, idx) => {
    if (idx > 0) pdf.addPage();

    // Config par page : on synchronise pageNumber et totalPages
    const cfg: PdfProConfig = {
      ...docDef.config,
      pageTitle: docDef.config.pageTitle || page.title,
      pageSubtitle: docDef.config.pageSubtitle || page.title,
      pageNumber: idx + 1,
      totalPages,
    };

    // 1) Header
    const afterHeaderY = drawPdfHeader(pdf, cfg, idx);

    // 2) Layout : vue a gauche, tableaux a droite (si vue presente)
    const hasView = !!page.view?.pngDataUrl;
    const viewMaxW = hasView ? Math.floor(contentWidth * 0.5) - 8 : 0;
    const tablesX = hasView ? contentLeft + viewMaxW + 16 : contentLeft;
    const tablesMaxW = hasView ? contentWidth - viewMaxW - 16 : contentWidth;

    // 2a) Cotations top (au-dessus de la vue, si fournies)
    let viewY = afterHeaderY;
    if (hasView && page.topDimensions && page.topDimensions.fractions.length > 0) {
      drawTopDimensions(
        pdf,
        contentLeft,
        viewY,
        page.topDimensions.fractions,
        viewMaxW,
      );
      viewY += TOP_DIMENSIONS_HEIGHT_PT;
    }

    // 2b) Vue SVG (PNG)
    let viewBottomY = viewY;
    if (hasView && page.view) {
      const maxH = contentBottom - viewY - 80; // garde de la place pour notes
      viewBottomY = drawSvgView(pdf, page.view, contentLeft, viewY, viewMaxW, maxH);
    }

    // 2c) Diagonale carree juste sous la vue (encadre)
    if (hasView && page.diagonalCarree) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(...COLORS.accent);
      pdf.text(
        `MESURE DIAGONALE CARREE : ${page.diagonalCarree}`,
        contentLeft + viewMaxW / 2,
        viewBottomY + 10,
        { align: 'center' },
      );
      viewBottomY += 16;
    }

    // 3) Tableaux (a droite si vue, plein largeur sinon)
    const tablesStartY = afterHeaderY;
    const afterTablesY = drawTables(pdf, page.tables, tablesX, tablesStartY, tablesMaxW);

    // 4) Notes : sous la zone la plus basse (vue ou tableaux)
    const bottomZoneY = Math.max(viewBottomY, afterTablesY);
    const notesY = Math.min(bottomZoneY, contentBottom - 40);
    drawNotes(pdf, page.notes, contentLeft, notesY);

    // 5) Footer
    drawPdfFooter(pdf, cfg, idx);
  });

  return pdf;
}

// ============================================================================
// LIMITATIONS CONNUES (documentees pour le caller)
// ----------------------------------------------------------------------------
// 1. Les "fleches" des cotations top sont des chevrettes traces a la ligne,
//    pas des fleches SVG converties. Visuel proche mais simplifie.
// 2. Pas de gestion automatique de page break si un tableau depasse la zone
//    de contenu — autoTable ajoutera lui-meme des pages au besoin mais le
//    layout vue+tableaux cote-a-cote n'est pas reflowe.
// 3. Le rendu SVG -> PNG via canvas peut tainter le canvas si le SVG
//    reference des images externes non CORS-friendly. Restez sur du SVG
//    inline (paths, text, rect) pour eviter ce probleme.
// 4. Les fonts sont limitees a celles bundlees par jsPDF (helvetica). Pas
//    de support de fonts custom sans .addFont() supplementaire.
// 5. Les cotations top sont reparties de facon EQUIDISTANTE sur la largeur
//    de la vue. Pour un placement proportionnel reel aux positions des
//    montants, le caller doit pre-calculer les positions et fournir une
//    fraction par interval (et idealement etendre l'API avec positions x).
// 6. Pas de support tagged PDF / PDF/UA accessibilite. jsPDF ne genere pas
//    de structure document accessible (lecteurs d'ecran). Limitation
//    inherente a jsPDF, non corrigeable cote helper.
// ============================================================================
