/**
 * ERP React Frontend - Exports API Module
 * Authenticated HTML export: opens window synchronously (preserves user gesture),
 * then fetches HTML with JWT and writes it into the window.
 */

import api from './client';

/**
 * Fetch HTML export with auth token and display in a new tab.
 * Opens the window BEFORE the async fetch to preserve the user-gesture
 * context and avoid popup blockers.
 */
export async function openExportHtml(url: string): Promise<void> {
  // Open blank window synchronously — preserves user-gesture for popup blocker
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Popup bloque. Veuillez autoriser les popups pour ce site.');
  }
  // Show a loading message while fetching
  win.document.write('<html><head><title>Chargement...</title></head><body style="font-family:sans-serif;padding:40px;color:#666">Chargement du document...</body></html>');

  try {
    // Fetch HTML with auth header — no leading slash so axios appends to baseURL
    const { data } = await api.get(url, {
      responseType: 'text',
      transformResponse: [(d: string) => d],
    });
    // Replace loading content with the actual HTML
    win.document.open();
    win.document.write(data);
    win.document.close();
  } catch (err) {
    win.document.open();
    win.document.write('<html><head><title>Erreur</title></head><body style="font-family:sans-serif;padding:40px;color:#c00">Erreur lors du chargement du document.</body></html>');
    win.document.close();
    throw err;
  }
}

/** Fetch and open devis HTML export. */
export const openDevisExport = (id: number) =>
  openExportHtml(`exports/devis/${id}/html`);

/** Fetch and open invoice HTML export. */
export const openInvoiceExport = (id: number) =>
  openExportHtml(`exports/invoice/${id}/html`);

/** Fetch and open work order HTML export. */
export const openWorkOrderExport = (id: number) =>
  openExportHtml(`exports/work-order/${id}/html`);
