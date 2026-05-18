/**
 * ERP React Frontend - Companies Page
 * CRUD for companies (clients/fournisseurs) with search, filter, and inline detail.
 * Mobile-first responsive layout.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Building2, Plus, Search, Phone, Mail, MapPin, X, Trash2, Pencil,
  FileText, FolderKanban, Globe, ChevronLeft, RefreshCw,
} from 'lucide-react';
import api from '@/api/client';
import * as companiesApi from '@/api/companies';
import type { Company, CompanyCreate, Contact } from '@/api/companies';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import StatCard from '@/components/dashboard/StatCard';
import { formatDate, formatPhone } from '@/utils/format';
import { useSortable } from '@/hooks/useSortable';
import { useColumnResize } from '@/hooks/useColumnResize';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { CommandBar } from '@/components/ui/CommandBar';

type PageTab = 'entreprises' | 'statistiques';

// Types d'entreprises construction Quebec (from Streamlit)
const TYPE_ENTREPRISE_OPTIONS = [
  { value: 'Entrepreneur général', label: 'Entrepreneur général' },
  { value: 'Sous-traitant spécialisé', label: 'Sous-traitant spécialisé' },
  { value: 'Promoteur immobilier', label: 'Promoteur immobilier' },
  { value: 'Fournisseur matériaux', label: 'Fournisseur matériaux' },
  { value: 'Consultant/Ingénieur', label: 'Consultant/Ingénieur' },
  { value: 'Architecte', label: 'Architecte' },
  { value: 'Arpenteur-géomètre', label: 'Arpenteur-géomètre' },
  { value: 'Organisme de contrôle', label: 'Organisme de contrôle' },
  { value: 'Institution financière', label: 'Institution financière' },
  { value: 'Assureur', label: 'Assureur' },
  { value: 'Client résidentiel', label: 'Client résidentiel' },
  { value: 'Client commercial', label: 'Client commercial' },
  { value: 'Client industriel', label: 'Client industriel' },
  { value: 'Municipalité', label: 'Municipalité' },
];

// Secteurs construction specialises (from Streamlit)
const SECTEUR_OPTIONS = [
  { value: '', label: 'Sélectionner un secteur' },
  { value: 'Construction résidentielle', label: 'Construction résidentielle' },
  { value: 'Construction commerciale', label: 'Construction commerciale' },
  { value: 'Construction industrielle', label: 'Construction industrielle' },
  { value: 'Rénovation résidentielle', label: 'Rénovation résidentielle' },
  { value: 'Rénovation commerciale', label: 'Rénovation commerciale' },
  { value: 'Excavation et terrassement', label: 'Excavation et terrassement' },
  { value: 'Fondations spécialisées', label: 'Fondations spécialisées' },
  { value: 'Charpenterie générale', label: 'Charpenterie générale' },
  { value: 'Couverture et toiture', label: 'Couverture et toiture' },
  { value: 'Plomberie et chauffage', label: 'Plomberie et chauffage' },
  { value: 'Électricité du bâtiment', label: 'Électricité du bâtiment' },
  { value: 'Isolation et étanchéité', label: 'Isolation et étanchéité' },
  { value: 'Revêtements extérieurs', label: 'Revêtements extérieurs' },
  { value: 'Finition intérieure', label: 'Finition intérieure' },
  { value: 'Aménagement paysager', label: 'Aménagement paysager' },
  { value: 'Démolition', label: 'Démolition' },
  { value: 'Location d\'équipements', label: 'Location d\'équipements' },
  { value: 'Transport construction', label: 'Transport construction' },
];

// Filter options (for table filter - simpler set)
const FILTER_TYPE_OPTIONS = [
  { value: '', label: 'Tous les types' },
  ...TYPE_ENTREPRISE_OPTIONS,
];

const TYPE_COLORS: Record<string, 'blue' | 'green' | 'yellow' | 'purple' | 'gray'> = {
  'Entrepreneur général': 'blue',
  'Sous-traitant spécialisé': 'purple',
  'Promoteur immobilier': 'yellow',
  'Fournisseur matériaux': 'green',
  'Consultant/Ingénieur': 'blue',
  'Architecte': 'blue',
  'Client résidentiel': 'blue',
  'Client commercial': 'blue',
  'Client industriel': 'blue',
  Client: 'blue',
  Fournisseur: 'green',
  Prospect: 'yellow',
  'Sous-traitant': 'purple',
};

export default function CompaniesPage() {
  const [_pageTab, _setPageTab] = useState<PageTab>('entreprises');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  // Create form
  const [form, setForm] = useState<CompanyCreate>({
    nom: '',
    typeCompany: 'Entrepreneur général',
    province: 'Québec',
    pays: 'Canada',
  });

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<Partial<CompanyCreate>>({});
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Contacts for dropdown
  const [allContacts, setAllContacts] = useState<Contact[]>([]);

  // Linked items for detail view
  const [linkedDevis, setLinkedDevis] = useState<Record<string, unknown>[]>([]);
  const [linkedProjects, setLinkedProjects] = useState<Record<string, unknown>[]>([]);
  const [linkedLoading, setLinkedLoading] = useState(false);

  const perPage = 20;

  const fetchCompanies = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await companiesApi.listCompanies({
        page, perPage, search: search || undefined, typeFilter: typeFilter || undefined,
      });
      setCompanies(res.items);
      setTotal(res.total);
    } catch {
      setError('Erreur lors du chargement');
    } finally {
      setIsLoading(false);
    }
  }, [page, search, typeFilter]);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await companiesApi.listContacts({ perPage: 100 });
      setAllContacts(res.items);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  const handleCreate = async () => {
    if (!form.nom.trim()) return;
    try {
      await companiesApi.createCompany(form);
      setShowCreate(false);
      setForm({ nom: '', typeCompany: 'Entrepreneur général', province: 'Québec', pays: 'Canada' });
      fetchCompanies();
    } catch {
      setError('Erreur lors de la création');
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Voulez-vous vraiment supprimer cette entreprise ?')) return;
    try {
      await companiesApi.deleteCompany(id);
      setSelectedCompany(null);
      fetchCompanies();
    } catch {
      setError('Erreur lors de la suppression');
    }
  };

  const handleSelectCompany = async (id: number) => {
    try {
      const company = await companiesApi.getCompany(id);
      setSelectedCompany(company);
      setLinkedLoading(true);
      try {
        const [devisRes, projRes] = await Promise.all([
          api.get('/devis', { params: { search: company.nom, per_page: 5 } }).catch(() => ({ data: { items: [] } })),
          api.get('/projects', { params: { search: company.nom, per_page: 5 } }).catch(() => ({ data: { items: [] } })),
        ]);
        setLinkedDevis(devisRes.data.items || []);
        setLinkedProjects(projRes.data.items || []);
      } catch {
        setLinkedDevis([]);
        setLinkedProjects([]);
      } finally {
        setLinkedLoading(false);
      }
    } catch {
      setError('Erreur lors du chargement');
    }
  };

  const openCreate = () => {
    setForm({ nom: '', typeCompany: 'Entrepreneur général', province: 'Québec', pays: 'Canada' });
    fetchContacts();
    setShowCreate(true);
  };

  const openEdit = (company: Company) => {
    setEditForm({
      nom: company.nom,
      typeCompany: company.typeCompany || '',
      secteurActivite: company.secteurActivite || '',
      email: company.email || '',
      telephone: company.telephone || '',
      adresse: company.adresse || '',
      ville: company.ville || '',
      province: company.province || 'Québec',
      codePostal: company.codePostal || '',
      pays: company.pays || 'Canada',
      siteWeb: company.siteWeb || '',
      contactPrincipalId: company.contactPrincipalId || undefined,
      notes: company.notes || '',
    });
    setEditError(null);
    fetchContacts();
    setShowEdit(true);
  };

  const handleEdit = async () => {
    if (!selectedCompany || !editForm.nom?.trim()) return;
    setEditLoading(true);
    setEditError(null);
    try {
      await companiesApi.updateCompany(selectedCompany.id, editForm);
      setShowEdit(false);
      const updated = await companiesApi.getCompany(selectedCompany.id);
      setSelectedCompany(updated);
      fetchCompanies();
    } catch {
      setEditError('Erreur lors de la mise à jour');
    } finally {
      setEditLoading(false);
    }
  };

  const { sortedItems: sortedCompanies, sortConfig, requestSort } = useSortable(companies);
  const { colWidths, startResize, autoFit } = useColumnResize({ nom: 200, typeCompany: 160, telephone: 150, ville: 120, actions: 80 });

  const totalPages = Math.ceil(total / perPage);

  // Shared form fields component
  const renderFormFields = (
    f: Partial<CompanyCreate>,
    setF: (val: Partial<CompanyCreate>) => void,
  ) => (
    <>
      <Input label="Nom de l'entreprise *" value={f.nom || ''} onChange={(e) => setF({ ...f, nom: e.target.value })} required />
      <Select
        label="Type d'entreprise *"
        options={TYPE_ENTREPRISE_OPTIONS}
        value={f.typeCompany || 'Entrepreneur général'}
        onChange={(e) => setF({ ...f, typeCompany: e.target.value })}
      />
      <Select
        label="Secteur d'activité construction"
        options={SECTEUR_OPTIONS}
        value={f.secteurActivite || ''}
        onChange={(e) => setF({ ...f, secteurActivite: e.target.value })}
      />

      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 pt-2">Adresse</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Adresse (rue, numéro)" value={f.adresse || ''} onChange={(e) => setF({ ...f, adresse: e.target.value })} />
        <Input label="Ville" value={f.ville || ''} onChange={(e) => setF({ ...f, ville: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Province/État" value={f.province || ''} onChange={(e) => setF({ ...f, province: e.target.value })} />
        <Input label="Code postal" value={f.codePostal || ''} onChange={(e) => setF({ ...f, codePostal: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Pays" value={f.pays || ''} onChange={(e) => setF({ ...f, pays: e.target.value })} />
      </div>

      <Input label="Site Web" value={f.siteWeb || ''} onChange={(e) => setF({ ...f, siteWeb: e.target.value })} />

      <Select
        label="Contact Principal"
        options={[
          { value: '', label: 'Aucun' },
          ...allContacts.map((c) => ({
            value: String(c.id),
            label: `${c.prenom} ${c.nomFamille}${c.companyNom ? ` (${c.companyNom})` : ''}`,
          })),
        ]}
        value={f.contactPrincipalId ? String(f.contactPrincipalId) : ''}
        onChange={(e) => setF({ ...f, contactPrincipalId: e.target.value ? parseInt(e.target.value) : undefined })}
      />

      <Textarea label="Notes sur l'entreprise" value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} />
    </>
  );

  /** Detail panel content — reused for both inline (desktop) and overlay (mobile) */
  const renderDetailPanel = () => {
    if (!selectedCompany) return null;
    return (
      <>
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0 flex-1 mr-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {selectedCompany.nom}
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <Badge color={TYPE_COLORS[selectedCompany.typeCompany || ''] || 'gray'}>
                {selectedCompany.typeCompany || '--'}
              </Badge>
              {selectedCompany.secteurActivite && (
                <span className="text-xs text-gray-500">{selectedCompany.secteurActivite}</span>
              )}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => openEdit(selectedCompany)}
              className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
              title="Modifier"
            >
              <Pencil size={16} />
            </button>
            <button
              onClick={() => handleDelete(selectedCompany.id)}
              className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={() => setSelectedCompany(null)}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="space-y-3 text-sm">
          {selectedCompany.email && (
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <Mail size={14} className="shrink-0" /> <span className="truncate">{selectedCompany.email}</span>
            </div>
          )}
          {selectedCompany.telephone && (
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <Phone size={14} className="shrink-0" /> {formatPhone(selectedCompany.telephone)}
            </div>
          )}
          {(selectedCompany.adresse || selectedCompany.ville) && (
            <div className="flex items-start gap-2 text-gray-600 dark:text-gray-400">
              <MapPin size={14} className="shrink-0 mt-0.5" />
              <span>{[selectedCompany.adresse, selectedCompany.ville, selectedCompany.province, selectedCompany.pays].filter(Boolean).join(', ')}</span>
            </div>
          )}
          {selectedCompany.siteWeb && (
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <Globe size={14} className="shrink-0" /> <span className="truncate">{selectedCompany.siteWeb}</span>
            </div>
          )}
          {selectedCompany.paymentTerms && (
            <div className="text-gray-500">Paiement: {selectedCompany.paymentTerms}</div>
          )}
          {selectedCompany.notes && (
            <div className="text-gray-500 mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs">
              {selectedCompany.notes}
            </div>
          )}
          <div className="text-xs text-gray-400">
            Créé le {formatDate(selectedCompany.createdAt)}
          </div>
        </div>

        {/* Contacts */}
        {selectedCompany.contacts && selectedCompany.contacts.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Contacts ({selectedCompany.contacts.length})
            </h4>
            <div className="space-y-2">
              {selectedCompany.contacts.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-2 rounded border border-gray-100 dark:border-gray-800">
                  <div className="w-8 h-8 rounded-full bg-seaop-primary-100 dark:bg-seaop-primary-900/30 flex items-center justify-center text-xs font-medium text-seaop-primary-600 shrink-0">
                    {c.prenom?.[0]}{c.nomFamille?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {c.prenom} {c.nomFamille}
                      {c.estPrincipal && <Badge color="blue" size="sm">Principal</Badge>}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {[c.rolePoste, c.email].filter(Boolean).join(' - ')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Linked Devis */}
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
            <FileText size={14} /> Soumissions recentes
          </h4>
          {linkedLoading ? (
            <div className="flex justify-center py-2"><Spinner size="sm" /></div>
          ) : linkedDevis.length > 0 ? (
            <div className="space-y-1.5">
              {linkedDevis.map((d, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded border border-gray-100 dark:border-gray-800 text-xs gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-seaop-primary-600">{String(d.numero || d.reference || `DEV-${i + 1}`)}</span>
                    <span className="ml-2 text-gray-500 hidden sm:inline">{String(d.description || d.objet || '--')}</span>
                  </div>
                  <Badge color={String(d.statut) === 'ACCEPTE' ? 'green' : String(d.statut) === 'REFUSE' ? 'red' : 'yellow'} size="sm">
                    {String(d.statut || 'BROUILLON')}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Aucune soumission</p>
          )}
        </div>

        {/* Linked Projects */}
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
            <FolderKanban size={14} /> Projets recents
          </h4>
          {linkedLoading ? (
            <div className="flex justify-center py-2"><Spinner size="sm" /></div>
          ) : linkedProjects.length > 0 ? (
            <div className="space-y-1.5">
              {linkedProjects.map((p, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded border border-gray-100 dark:border-gray-800 text-xs gap-2">
                  <span className="font-medium text-gray-900 dark:text-white truncate">{String(p.nom || p.name || `Projet ${i + 1}`)}</span>
                  <Badge color={String(p.statut) === 'TERMINE' ? 'green' : String(p.statut) === 'EN_COURS' ? 'blue' : 'gray'} size="sm">
                    {String(p.statut || '--')}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Aucun projet</p>
          )}
        </div>
      </>
    );
  };

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}

      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Entreprises</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Total" value={total} icon={<Building2 size={20} />} color="blue" />
        <StatCard label="Clients" value={companies.filter(c => (c.typeCompany || '').includes('Client')).length} icon={<Building2 size={20} />} color="blue" />
        <StatCard label="Fournisseurs" value={companies.filter(c => (c.typeCompany || '').includes('Fournisseur')).length} icon={<Building2 size={20} />} color="green" />
        <StatCard label="Sous-traitants" value={companies.filter(c => (c.typeCompany || '').includes('Sous-traitant')).length} icon={<Building2 size={20} />} color="purple" />
      </div>

      {/* D365-style CommandBar */}
      <CommandBar
        actions={[
          { label: 'Nouvelle entreprise', icon: <Plus size={15} />, onClick: openCreate, variant: 'primary' },
          { label: 'Rafraîchir', icon: <RefreshCw size={15} />, onClick: fetchCompanies },
        ]}
        right={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Rechercher par nom, email, ville..."
                className="erp-input pl-9 w-full"
              />
            </div>
            <div className="w-56">
              <Select
                options={FILTER_TYPE_OPTIONS}
                value={typeFilter}
                onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        }
      />

      {/* Content — on mobile: detail replaces list; on desktop: side-by-side */}
      <div className="flex gap-6">
        {/* Company List — hidden on mobile when detail is open */}
        <div className={`flex-1 min-w-0 ${selectedCompany ? 'hidden md:block md:max-w-[60%]' : ''}`}>
          {isLoading ? (
            <SkeletonPage />
          ) : (
            <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <SortableHeader label="Nom" sortKey="nom" sortConfig={sortConfig} onSort={requestSort} width={colWidths.nom} onResizeStart={(e) => startResize(e, 'nom')} onAutoFit={(e) => autoFit(e, 'nom')} />
                        <SortableHeader label="Type" sortKey="typeCompany" sortConfig={sortConfig} onSort={requestSort} width={colWidths.typeCompany} onResizeStart={(e) => startResize(e, 'typeCompany')} onAutoFit={(e) => autoFit(e, 'typeCompany')} />
                        <SortableHeader label="Contact" sortKey="telephone" sortConfig={sortConfig} onSort={requestSort} width={colWidths.telephone} onResizeStart={(e) => startResize(e, 'telephone')} onAutoFit={(e) => autoFit(e, 'telephone')} />
                        <SortableHeader label="Ville" sortKey="ville" sortConfig={sortConfig} onSort={requestSort} width={colWidths.ville} onResizeStart={(e) => startResize(e, 'ville')} onAutoFit={(e) => autoFit(e, 'ville')} />
                        <th className="relative px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase" style={{ width: colWidths.actions, minWidth: 40 }}>
                          Actions
                          <div
                            className="absolute top-0 bottom-0 right-0 w-1.5 cursor-col-resize hover:bg-blue-300 z-10"
                            onMouseDown={(e) => { e.stopPropagation(); startResize(e, 'actions'); }}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {sortedCompanies.map((c) => (
                        <tr
                          key={c.id}
                          onClick={() => handleSelectCompany(c.id)}
                          className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30 ${
                            selectedCompany?.id === c.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                          }`}
                        >
                          <td className="px-4 py-3" style={{ width: colWidths.nom }}>
                            <div className="font-medium text-gray-900 dark:text-white truncate">{c.nom}</div>
                            {c.email && <div className="text-xs text-gray-400 truncate">{c.email}</div>}
                          </td>
                          <td className="px-4 py-3" style={{ width: colWidths.typeCompany }}>
                            <Badge color={TYPE_COLORS[c.typeCompany || ''] || 'gray'}>
                              {c.typeCompany || '--'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400" style={{ width: colWidths.telephone }}>
                            {c.telephone ? formatPhone(c.telephone) : '--'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400" style={{ width: colWidths.ville }}>
                            {c.ville || '--'}
                          </td>
                          <td className="px-4 py-3 text-center" style={{ width: colWidths.actions }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSelectCompany(c.id).then(() => { setTimeout(() => { const co = companies.find(x => x.id === c.id); if (co) openEdit(co); }, 100); }); }}
                              className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
                              title="Modifier"
                            >
                              <Pencil size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {companies.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                          Aucune entreprise trouvée
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Mobile cards */}
              <div className="md:hidden space-y-2">
                {sortedCompanies.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => handleSelectCompany(c.id)}
                    className={`border rounded-lg p-3 cursor-pointer transition-colors active:bg-gray-50 dark:active:bg-gray-800/30 ${
                      selectedCompany?.id === c.id
                        ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate mr-2">{c.nom}</span>
                      <Badge color={TYPE_COLORS[c.typeCompany || ''] || 'gray'} size="sm">
                        {c.typeCompany || '--'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                      {c.email && (
                        <span className="flex items-center gap-1 truncate"><Mail size={11} /> {c.email}</span>
                      )}
                      {c.telephone && (
                        <span className="flex items-center gap-1"><Phone size={11} /> {formatPhone(c.telephone)}</span>
                      )}
                      {c.ville && (
                        <span className="flex items-center gap-1"><MapPin size={11} /> {c.ville}</span>
                      )}
                    </div>
                  </div>
                ))}
                {companies.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-8">Aucune entreprise trouvée</p>
                )}
              </div>

              {totalPages > 1 && (
                <div className="mt-4">
                  <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
                </div>
              )}
              <p className="mt-2 text-xs text-gray-400 text-center">{total} entreprise{total !== 1 ? 's' : ''}</p>
            </>
          )}
        </div>

        {/* Detail Panel — desktop: sidebar; mobile: full-width overlay */}
        {selectedCompany && (
          <>
            {/* Mobile: full-width with back button */}
            <div className="md:hidden flex-1">
              <button
                onClick={() => setSelectedCompany(null)}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3"
              >
                <ChevronLeft size={16} /> Retour a la liste
              </button>
              <Card>
                {renderDetailPanel()}
              </Card>
            </div>

            {/* Desktop: side panel */}
            <div className="hidden md:block w-[40%] min-w-[300px]">
              <Card>
                {renderDetailPanel()}
              </Card>
            </div>
          </>
        )}
      </div>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouvelle entreprise" size="lg">
        <div className="space-y-4">
          {renderFormFields(form, (val) => setForm(val as CompanyCreate))}
          <p className="text-xs text-gray-400">* Champs obligatoires</p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Annuler</Button>
            <Button onClick={handleCreate} disabled={!form.nom.trim()}>Enregistrer</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Modifier l'entreprise" size="lg">
        <div className="space-y-4">
          {editError && <Alert type="error" onClose={() => setEditError(null)}>{editError}</Alert>}
          {renderFormFields(editForm, setEditForm)}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowEdit(false)}>Annuler</Button>
            <Button onClick={handleEdit} isLoading={editLoading} disabled={!editForm.nom?.trim()}>Enregistrer</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
