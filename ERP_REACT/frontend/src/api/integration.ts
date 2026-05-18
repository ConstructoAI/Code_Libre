/**
 * ERP React Frontend - Integration API Module
 * QuickBooks & Sage 50 integration management.
 */

import api from './client';

// ============ Types ============

export interface IntegrationConnection {
  id: number;
  provider: 'quickbooks' | 'sage50';
  name: string;
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  lastSyncAt?: string;
  syncFrequency?: string;
  config: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SyncLog {
  id: number;
  connectionId: number;
  provider: string;
  direction: 'export' | 'import';
  entityType: string;
  entityId?: number;
  status: 'success' | 'error' | 'pending' | 'skipped';
  details?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface SyncStats {
  totalSyncs: number;
  successCount: number;
  errorCount: number;
  lastSyncAt?: string;
  byProvider: { provider: string; count: number; errors: number }[];
  byEntity: { entity: string; exported: number; imported: number }[];
}

export interface WebhookConfig {
  id: number;
  url: string;
  events: string[];
  secret?: string;
  description?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WebhookDelivery {
  id: number;
  webhookId: number;
  eventType: string;
  responseStatus?: number;
  responseBody?: string;
  success: boolean;
  deliveredAt: string;
}

export interface DataMapping {
  constructoField: string;
  externalField: string;
  entityType: string;
  direction: 'export' | 'import' | 'both';
}

// ============ Connections ============

export async function listConnections(): Promise<{ items: IntegrationConnection[]; total: number }> {
  try {
    const { data } = await api.get('/integrations');
    return data;
  } catch {
    return { items: [], total: 0 };
  }
}

export async function createConnection(body: {
  provider: string;
  name: string;
  config: Record<string, unknown>;
}): Promise<{ id: number; message: string }> {
  const { data } = await api.post('/integrations', body);
  return data;
}

export async function updateConnection(id: number, body: {
  name?: string;
  status?: string;
  syncFrequency?: string;
  config?: Record<string, unknown>;
}): Promise<{ message: string }> {
  const { data } = await api.put(`/integrations/${id}`, body);
  return data;
}

export async function deleteConnection(id: number): Promise<{ message: string }> {
  const { data } = await api.delete(`/integrations/${id}`);
  return data;
}

export async function testConnection(id: number): Promise<{ success: boolean; message: string }> {
  const { data } = await api.post(`/integrations/${id}/test`);
  return data;
}

// ============ QuickBooks OAuth ============

export async function getQuickBooksAuthUrl(connectionId: number): Promise<{ authUrl: string; state: string }> {
  const { data } = await api.get('/integrations/quickbooks/auth-url', { params: { connectionId } });
  return data;
}

export async function quickBooksOAuthCallback(body: {
  code: string;
  realmId: string;
  state?: string;
}): Promise<{ message: string; connectionId: number; realmId: string }> {
  const { data } = await api.post('/integrations/quickbooks/callback', body);
  return data;
}

// ============ Sync ============

export async function triggerSync(connectionId: number, options?: {
  direction?: 'export' | 'import';
  entityType?: string;
}): Promise<{ message: string; synced: number; errors: number; details: string[]; status: string }> {
  const { data } = await api.post(`/integrations/${connectionId}/sync`, options);
  return data;
}

export async function getSyncHistory(params?: {
  page?: number;
  perPage?: number;
  provider?: string;
  status?: string;
  entityType?: string;
}): Promise<{ items: SyncLog[]; total: number }> {
  try {
    const { data } = await api.get('/integrations/sync-history', { params });
    return data;
  } catch {
    return { items: [], total: 0 };
  }
}

export async function getSyncStats(): Promise<SyncStats> {
  try {
    const { data } = await api.get('/integrations/sync-stats');
    return data;
  } catch {
    return {
      totalSyncs: 0,
      successCount: 0,
      errorCount: 0,
      byProvider: [],
      byEntity: [],
    };
  }
}

// ============ Webhooks (via config endpoints) ============

export async function listWebhooks(): Promise<{ items: WebhookConfig[]; total: number }> {
  try {
    const { data } = await api.get('/config/webhooks');
    const items = data?.items ?? data ?? [];
    return { items, total: items.length };
  } catch {
    return { items: [], total: 0 };
  }
}

export async function createWebhook(body: {
  url: string;
  events?: string[];
  secret?: string;
  description?: string;
}): Promise<{ id: number; secret?: string; message: string }> {
  const { data } = await api.post('/config/webhooks', body);
  return data;
}

export async function updateWebhook(id: number, body: {
  url?: string;
  events?: string[];
  secret?: string;
  description?: string;
  active?: boolean;
}): Promise<{ message: string }> {
  const { data } = await api.put(`/config/webhooks/${id}`, body);
  return data;
}

export async function deleteWebhook(id: number): Promise<void> {
  await api.delete(`/config/webhooks/${id}`);
}

export async function testWebhook(id: number): Promise<{ success: boolean; statusCode?: number }> {
  const { data } = await api.post(`/config/webhooks/${id}/test`);
  return data;
}

export async function getWebhookDeliveries(webhookId: number, limit?: number): Promise<WebhookDelivery[]> {
  const { data } = await api.get(`/config/webhooks/${webhookId}/deliveries`, { params: { limit } });
  return data?.items ?? data ?? [];
}

// ============ Data Mapping Reference ============

export const QUICKBOOKS_MAPPINGS: DataMapping[] = [
  { constructoField: 'nom', externalField: 'DisplayName / CompanyName', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'email', externalField: 'PrimaryEmailAddr.Address', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'telephone', externalField: 'PrimaryPhone.FreeFormNumber', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'adresse', externalField: 'BillAddr.Line1', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'ville', externalField: 'BillAddr.City', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'province', externalField: 'BillAddr.CountrySubDivisionCode', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'code_postal', externalField: 'BillAddr.PostalCode', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'numero', externalField: 'DocNumber', entityType: 'Facture', direction: 'export' },
  { constructoField: 'date_facture', externalField: 'TxnDate', entityType: 'Facture', direction: 'export' },
  { constructoField: 'date_echeance', externalField: 'DueDate', entityType: 'Facture', direction: 'export' },
  { constructoField: 'montant_ttc', externalField: 'TotalAmt', entityType: 'Facture', direction: 'export' },
  { constructoField: 'description (ligne)', externalField: 'Description', entityType: 'Ligne facture', direction: 'export' },
  { constructoField: 'quantite', externalField: 'SalesItemLineDetail.Qty', entityType: 'Ligne facture', direction: 'export' },
  { constructoField: 'prix_unitaire', externalField: 'SalesItemLineDetail.UnitPrice', entityType: 'Ligne facture', direction: 'export' },
  { constructoField: 'montant', externalField: 'TotalAmt', entityType: 'Paiement', direction: 'export' },
  { constructoField: 'date_paiement', externalField: 'TxnDate', entityType: 'Paiement', direction: 'export' },
  { constructoField: 'methode_paiement', externalField: 'PaymentMethodRef', entityType: 'Paiement', direction: 'export' },
];

export const SAGE50_MAPPINGS: DataMapping[] = [
  { constructoField: 'nom', externalField: 'CustomerName', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'email', externalField: 'Email', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'telephone', externalField: 'Telephone1', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'adresse', externalField: 'Address.Street1', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'ville', externalField: 'Address.City', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'province', externalField: 'Address.Province', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'code_postal', externalField: 'Address.PostalCode', entityType: 'Entreprise', direction: 'both' },
  { constructoField: 'numero', externalField: 'InvoiceNumber', entityType: 'Facture', direction: 'export' },
  { constructoField: 'date_facture', externalField: 'InvoiceDate', entityType: 'Facture', direction: 'export' },
  { constructoField: 'montant_ttc', externalField: 'Total', entityType: 'Facture', direction: 'export' },
  { constructoField: 'description (ligne)', externalField: 'ItemDescription', entityType: 'Ligne facture', direction: 'export' },
  { constructoField: 'quantite', externalField: 'Quantity', entityType: 'Ligne facture', direction: 'export' },
  { constructoField: 'prix_unitaire', externalField: 'Price', entityType: 'Ligne facture', direction: 'export' },
  { constructoField: 'montant', externalField: 'AmountPaid', entityType: 'Paiement', direction: 'export' },
  { constructoField: 'date_paiement', externalField: 'DatePaid', entityType: 'Paiement', direction: 'export' },
];

export const WEBHOOK_EVENTS = [
  { event: 'invoice.created', label: 'Facture cr\u00e9\u00e9e', category: 'Factures' },
  { event: 'invoice.updated', label: 'Facture modifi\u00e9e', category: 'Factures' },
  { event: 'invoice.sent', label: 'Facture envoy\u00e9e', category: 'Factures' },
  { event: 'invoice.paid', label: 'Facture pay\u00e9e', category: 'Factures' },
  { event: 'invoice.overdue', label: 'Facture en retard', category: 'Factures' },
  { event: 'invoice.cancelled', label: 'Facture annul\u00e9e', category: 'Factures' },
  { event: 'payment.received', label: 'Paiement re\u00e7u', category: 'Paiements' },
  { event: 'payment.refunded', label: 'Remboursement', category: 'Paiements' },
  { event: 'project.created', label: 'Projet cr\u00e9\u00e9', category: 'Projets' },
  { event: 'project.updated', label: 'Projet modifi\u00e9', category: 'Projets' },
  { event: 'project.status_changed', label: 'Statut projet chang\u00e9', category: 'Projets' },
  { event: 'company.created', label: 'Entreprise cr\u00e9\u00e9e', category: 'Entreprises' },
  { event: 'company.updated', label: 'Entreprise modifi\u00e9e', category: 'Entreprises' },
];
