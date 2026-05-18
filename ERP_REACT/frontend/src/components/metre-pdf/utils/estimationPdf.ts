import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Measurement, Product, LaborTrade } from '../types';
import { PRICE_UNITS } from '../types';

/* ── helpers ─────────────────────────────────── */

function fmt(n: number): string {
  if (!isFinite(n)) return '0,00';
  const abs = Math.abs(n);
  const formatted = (abs ?? 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return n < 0 ? `\u2212${formatted}` : formatted;
}

function unitLabel(val: string): string {
  return PRICE_UNITS.find((u) => u.value === val)?.label ?? val;
}

function today(): string {
  return new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

/* ── types ───────────────────────────────────── */

export interface PdfEstimationData {
  measurements: Measurement[];
  products: Product[];
  laborTrades?: LaborTrade[];
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
  companyName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyLicence?: string;
}

/* ── Build category cost data ────────────────── */

interface CostRow { product: string; measure: string; qty: number; unit: string; wastePct: number; qtyWaste: number; price: number; total: number; isDeduction: boolean; }
interface CategoryBlock { category: string; rows: CostRow[]; subtotal: number; }

function buildCategoryBlocks(data: PdfEstimationData): CategoryBlock[] {
  const { measurements, products, getNetValue } = data;
  const linked = measurements.filter((m) => m.productId);
  const catMap = new Map<string, CategoryBlock>();
  for (const m of linked) {
    const prod = products.find((p) => p.id === m.productId);
    if (!prod) continue;
    const slopeFactor = m.slopeFactor ?? 1;
    const isDeduction = m.isDeduction ?? false;
    const netQty = isDeduction ? 0 : getNetValue(m) * slopeFactor;
    const wasteFactor = 1 + (prod.wastePct || 0) / 100;
    const qtyWaste = isDeduction ? 0 : netQty * wasteFactor;
    const cost = isDeduction ? 0 : qtyWaste * prod.price;
    if (!catMap.has(prod.category)) catMap.set(prod.category, { category: prod.category, rows: [], subtotal: 0 });
    const cat = catMap.get(prod.category)!;
    cat.rows.push({ product: prod.name, measure: m.label || `${m.type} #${m.id.slice(-4)}`, qty: isDeduction ? -(m.quantity ?? m.value) * slopeFactor : netQty, unit: unitLabel(prod.priceUnit), wastePct: prod.wastePct || 0, qtyWaste, price: prod.price, total: cost, isDeduction });
    cat.subtotal += cost;
  }
  return Array.from(catMap.values());
}

/* ── Product summary (aggregated by product) ── */

interface ProductSummaryRow { product: string; category: string; totalQty: number; totalQtyWaste: number; unitPrice: number; priceUnit: string; totalCost: number; }

function buildProductSummary(data: PdfEstimationData): ProductSummaryRow[] {
  const { measurements, products, getNetValue } = data;
  const map = new Map<string, ProductSummaryRow>();
  for (const m of measurements) {
    if (!m.productId || m.isDeduction) continue;
    const prod = products.find((p) => p.id === m.productId);
    if (!prod) continue;
    const netQty = getNetValue(m) * (m.slopeFactor ?? 1);
    const wasteFactor = 1 + (prod.wastePct || 0) / 100;
    const qtyWaste = netQty * wasteFactor;
    const cost = qtyWaste * prod.price;
    if (!map.has(prod.id)) map.set(prod.id, { product: prod.name, category: prod.category, totalQty: 0, totalQtyWaste: 0, unitPrice: prod.price, priceUnit: unitLabel(prod.priceUnit), totalCost: 0 });
    const row = map.get(prod.id)!;
    row.totalQty += netQty;
    row.totalQtyWaste += qtyWaste;
    row.totalCost += cost;
  }
  return Array.from(map.values()).sort((a, b) => a.category.localeCompare(b.category));
}

/* ── Labor summary (aggregated by trade) ─────── */

interface LaborSummaryRow { trade: string; sector: string; hourlyRate: number; totalHours: number; totalPersons: number; totalCost: number; color: string; }

function buildLaborSummary(data: PdfEstimationData): LaborSummaryRow[] {
  const { measurements, laborTrades } = data;
  if (!laborTrades || laborTrades.length === 0) return [];
  const map = new Map<string, LaborSummaryRow>();
  for (const m of measurements) {
    if (!m.laborTradeId || m.isDeduction) continue;
    const trade = laborTrades.find((t) => t.id === m.laborTradeId);
    if (!trade) continue;
    const hours = m.laborHours ?? 0;
    if (hours <= 0) continue;
    const persons = m.laborPersons ?? trade.nbPersons;
    const cost = trade.hourlyRate * hours * persons;
    if (!map.has(trade.id)) map.set(trade.id, { trade: trade.trade, sector: trade.sector, hourlyRate: trade.hourlyRate, totalHours: 0, totalPersons: persons, totalCost: 0, color: trade.color });
    const row = map.get(trade.id)!;
    row.totalHours += hours;
    row.totalPersons = Math.max(row.totalPersons, persons);
    row.totalCost += cost;
  }
  return Array.from(map.values()).sort((a, b) => a.trade.localeCompare(b.trade));
}

/* ── main PDF generator ──────────────────────── */

const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;

const COLORS = {
  primary: [37, 99, 235] as [number, number, number],
  header: [15, 23, 42] as [number, number, number],
  headerText: [255, 255, 255] as [number, number, number],
  subtotal: [241, 245, 249] as [number, number, number],
  deduction: [254, 242, 242] as [number, number, number],
  accent: [5, 150, 105] as [number, number, number],
  lightGray: [248, 250, 252] as [number, number, number],
  textDark: [30, 41, 59] as [number, number, number],
  textMuted: [100, 116, 139] as [number, number, number],
  labor: [124, 58, 237] as [number, number, number],
};

export function generateEstimationPdf(data: PdfEstimationData): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // ── Header ──
  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(...COLORS.header);
  doc.text(data.companyName || 'CONSTRUCTO AI', margin, y + 6);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...COLORS.textMuted);
  if (data.companyAddress) doc.text(data.companyAddress, margin, y + 11);
  if (data.companyPhone) doc.text(data.companyPhone, margin, y + 15);
  if (data.companyEmail) doc.text(data.companyEmail, margin, y + 19);
  if (data.companyLicence) doc.text(`RBQ: ${data.companyLicence}`, margin, y + 23);
  doc.setFontSize(22); doc.setFont('helvetica', 'bold'); doc.setTextColor(...COLORS.primary);
  doc.text('SOUMISSION', pageWidth - margin, y + 6, { align: 'right' });
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...COLORS.textMuted);
  doc.text(`Date: ${today()}`, pageWidth - margin, y + 13, { align: 'right' });
  doc.text(`Projet: ${data.projectName || 'Sans titre'}`, pageWidth - margin, y + 18, { align: 'right' });
  y += 28;
  doc.setDrawColor(...COLORS.primary); doc.setLineWidth(0.8); doc.line(margin, y, pageWidth - margin, y); y += 6;

  // ── Client info ──
  if (data.clientName || data.clientAddress) {
    doc.setFillColor(...COLORS.lightGray); doc.roundedRect(margin, y, contentWidth, 18, 2, 2, 'F');
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...COLORS.textMuted);
    doc.text('CLIENT', margin + 4, y + 5);
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...COLORS.textDark);
    doc.text(data.clientName || '', margin + 4, y + 11);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...COLORS.textMuted);
    const addr = [data.clientAddress, data.clientCity].filter(Boolean).join(', ');
    if (addr) doc.text(addr, margin + 4, y + 15);
    y += 22;
  }

  // ── Stats ──
  const { measurements } = data;
  const nbMeasurements = measurements.filter((m) => !m.isDeduction).length;
  const nbDeductions = measurements.filter((m) => m.isDeduction).length;
  const nbProducts = new Set(measurements.filter((m) => m.productId && !m.isDeduction).map((m) => m.productId)).size;
  const nbPages = new Set(measurements.map((m) => m.pageNumber)).size;
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...COLORS.textMuted);
  doc.text(`${nbMeasurements} mesures | ${nbDeductions} d\u00e9ductions | ${nbProducts} produits | ${nbPages} page(s)`, margin, y + 3);
  y += 8;

  // ── Detailed cost table by category ──
  const categories = buildCategoryBlocks(data);
  const materialTotal = categories.reduce((s, c) => s + c.subtotal, 0);

  if (categories.length > 0) {
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(...COLORS.header);
    doc.text('D\u00c9TAIL DES MESURES ET CO\u00dbTS', margin, y + 4); y += 8;

    for (const cat of categories) {
      const tableBody: any[][] = [];
      for (const row of cat.rows) {
        const qtyStr = row.isDeduction ? `\u2212${fmt(Math.abs(row.qty))}` : fmt(row.qty);
        tableBody.push([
          { content: row.measure && row.measure !== row.product ? `${row.product}\n${row.measure}` : row.product, styles: { fontStyle: row.isDeduction ? 'italic' : 'normal' } },
          { content: qtyStr, styles: { halign: 'center' } },
          { content: row.unit, styles: { halign: 'center' } },
          { content: row.isDeduction ? '\u2014' : `${(row.wastePct ?? 0).toFixed(0)}%`, styles: { halign: 'center' } },
          { content: row.isDeduction ? '\u2014' : fmt(row.qtyWaste), styles: { halign: 'right' } },
          { content: `${fmt(row.price)} $`, styles: { halign: 'right' } },
          { content: row.isDeduction ? '\u2014' : `${fmt(row.total)} $`, styles: { halign: 'right', fontStyle: 'bold' } },
        ]);
      }
      tableBody.push([
        { content: `Sous-total \u2014 ${cat.category}`, colSpan: 6, styles: { fontStyle: 'bold', fillColor: COLORS.subtotal } },
        { content: `${fmt(cat.subtotal)} $`, styles: { halign: 'right', fontStyle: 'bold', fillColor: COLORS.subtotal } },
      ]);
      autoTable(doc, {
        startY: y, margin: { left: margin, right: margin },
        head: [
          [{ content: cat.category.toUpperCase(), colSpan: 7, styles: { fillColor: COLORS.accent, textColor: COLORS.headerText, fontStyle: 'bold', fontSize: 8 } }],
          ['Produit / Mesure', 'Quantit\u00e9', 'Unit\u00e9', 'Perte', 'Qt\u00e9+perte', 'Prix unit.', 'Montant'],
        ],
        body: tableBody,
        styles: { fontSize: 7.5, cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.2 },
        headStyles: { fillColor: COLORS.header, textColor: COLORS.headerText, fontStyle: 'bold', fontSize: 7 },
        columnStyles: { 0: { cellWidth: contentWidth * 0.28 }, 1: { cellWidth: contentWidth * 0.10 }, 2: { cellWidth: contentWidth * 0.08 }, 3: { cellWidth: contentWidth * 0.08 }, 4: { cellWidth: contentWidth * 0.14 }, 5: { cellWidth: contentWidth * 0.14 }, 6: { cellWidth: contentWidth * 0.18 } },
        didParseCell(hookData) {
          const rowIdx = hookData.row.index;
          if (hookData.section === 'body' && rowIdx < cat.rows.length && cat.rows[rowIdx]?.isDeduction) hookData.cell.styles.fillColor = COLORS.deduction;
        },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
      if (y > pageHeight - 60) { doc.addPage(); y = margin; }
    }
  }

  // ── Product summary table ──
  const productSummary = buildProductSummary(data);
  if (productSummary.length > 0) {
    if (y > pageHeight - 80) { doc.addPage(); y = margin; }
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(...COLORS.header);
    doc.text('R\u00c9SUM\u00c9 PAR PRODUIT', margin, y + 4); y += 8;
    const summaryBody = productSummary.map((r) => [
      r.product, r.category,
      { content: fmt(r.totalQty), styles: { halign: 'right' as const } }, r.priceUnit,
      { content: fmt(r.totalQtyWaste), styles: { halign: 'right' as const } },
      { content: `${fmt(r.unitPrice)} $`, styles: { halign: 'right' as const } },
      { content: `${fmt(r.totalCost)} $`, styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
    ]);
    autoTable(doc, {
      startY: y, margin: { left: margin, right: margin },
      head: [['Produit', 'Cat\u00e9gorie', 'Qt\u00e9 nette', 'Unit\u00e9', 'Qt\u00e9+perte', 'Prix unit.', 'Total']],
      body: summaryBody,
      styles: { fontSize: 7.5, cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.2 },
      headStyles: { fillColor: COLORS.primary, textColor: COLORS.headerText, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: COLORS.lightGray },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── Labor summary table (main-d'oeuvre CCQ) ──
  const laborSummary = buildLaborSummary(data);
  const laborTotal = laborSummary.reduce((s, r) => s + r.totalCost, 0);

  if (laborSummary.length > 0) {
    if (y > pageHeight - 80) { doc.addPage(); y = margin; }
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(...COLORS.labor);
    doc.text("MAIN-D\u2019\u0152UVRE (CORPS DE M\u00c9TIERS CCQ)", margin, y + 4); y += 8;

    const laborBody: any[][] = laborSummary.map((r) => [
      r.trade, r.sector,
      { content: `${fmt(r.hourlyRate)} $/h`, styles: { halign: 'right' as const } },
      { content: fmt(r.totalHours), styles: { halign: 'center' as const } },
      { content: String(r.totalPersons), styles: { halign: 'center' as const } },
      { content: `${fmt(r.totalCost)} $`, styles: { halign: 'right' as const, fontStyle: 'bold' as const } },
    ]);
    laborBody.push([
      { content: "TOTAL MAIN-D\u2019\u0152UVRE", colSpan: 5, styles: { fontStyle: 'bold', fillColor: COLORS.subtotal } } as any,
      { content: `${fmt(laborTotal)} $`, styles: { halign: 'right' as const, fontStyle: 'bold' as const, fillColor: COLORS.subtotal } },
    ]);
    autoTable(doc, {
      startY: y, margin: { left: margin, right: margin },
      head: [['Corps de m\u00e9tier', 'Secteur', 'Taux horaire', 'Heures', 'Pers.', 'Co\u00fbt']],
      body: laborBody,
      styles: { fontSize: 7.5, cellPadding: 2, lineColor: [226, 232, 240], lineWidth: 0.2 },
      headStyles: { fillColor: COLORS.labor, textColor: COLORS.headerText, fontStyle: 'bold', fontSize: 7 },
      alternateRowStyles: { fillColor: COLORS.lightGray },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ── Grand total with taxes ──
  const grandTotal = materialTotal + laborTotal;
  if (y > pageHeight - 50) { doc.addPage(); y = margin; }
  const tps = grandTotal * TPS_RATE;
  const tvq = grandTotal * TVQ_RATE;
  const totalWithTaxes = grandTotal + tps + tvq;
  const totalsX = pageWidth - margin - 70;
  const amountX = pageWidth - margin;

  doc.setDrawColor(...COLORS.primary); doc.setLineWidth(0.5); doc.line(totalsX - 5, y, amountX, y); y += 6;
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...COLORS.textDark);

  if (laborTotal > 0 && materialTotal > 0) {
    doc.text('Mat\u00e9riaux:', totalsX, y, { align: 'left' });
    doc.text(`${fmt(materialTotal)} $`, amountX, y, { align: 'right' }); y += 5;
    doc.setTextColor(...COLORS.labor);
    doc.text("Main-d\u2019\u0153uvre:", totalsX, y, { align: 'left' });
    doc.text(`${fmt(laborTotal)} $`, amountX, y, { align: 'right' }); y += 5;
    doc.setTextColor(...COLORS.textDark);
  }

  doc.text('Sous-total avant taxes:', totalsX, y, { align: 'left' });
  doc.text(`${fmt(grandTotal)} $`, amountX, y, { align: 'right' }); y += 5;
  doc.text('TPS (5%):', totalsX, y, { align: 'left' });
  doc.text(`${fmt(tps)} $`, amountX, y, { align: 'right' }); y += 5;
  doc.text('TVQ (9,975%):', totalsX, y, { align: 'left' });
  doc.text(`${fmt(tvq)} $`, amountX, y, { align: 'right' }); y += 3;

  doc.setDrawColor(...COLORS.header); doc.setLineWidth(0.8); doc.line(totalsX - 5, y, amountX, y); y += 6;
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(...COLORS.primary);
  doc.text('TOTAL:', totalsX, y, { align: 'left' });
  doc.text(`${fmt(totalWithTaxes)} $`, amountX, y, { align: 'right' });

  // ── Footer on every page ──
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...COLORS.textMuted); doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...COLORS.textMuted);
    doc.text(`${data.companyName || 'Constructo AI'} \u2014 Soumission g\u00e9n\u00e9r\u00e9e le ${today()}`, margin, pageHeight - 8);
    doc.text(`Page ${i} / ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  return doc;
}

/* ── Convenience wrappers ────────────────────── */

export function downloadEstimationPdf(data: PdfEstimationData, filename?: string): void {
  const doc = generateEstimationPdf(data);
  const name = filename || `soumission_${(data.projectName || 'projet').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(name);
}

export function openEstimationPdfInNewTab(data: PdfEstimationData): void {
  const doc = generateEstimationPdf(data);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
