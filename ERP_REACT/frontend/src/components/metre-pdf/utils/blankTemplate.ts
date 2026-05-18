/**
 * blankTemplate.ts — Generate an ARCH D (36"x24") blank template PDF
 * using TEMPLATE.jpg as the full-page background image.
 *
 * The TEMPLATE.jpg contains the standard Quebec construction cartouche
 * (title block) with all sections pre-drawn.
 *
 * Returns an ArrayBuffer that can be loaded by PDF.js via __metrePdfLoad().
 */

import jsPDF from 'jspdf';
import { TEMPLATE_JPG_BASE64 } from './templateImage';

// ARCH D dimensions in points (1 inch = 72 pt)
const W = 36 * 72;  // 2592 pt
const H = 24 * 72;  // 1728 pt

export function generateBlankTemplatePdf(): ArrayBuffer {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [W, H],
  });

  // Add TEMPLATE.jpg as full-page background
  doc.addImage(TEMPLATE_JPG_BASE64, 'JPEG', 0, 0, W, H);

  return doc.output('arraybuffer');
}
