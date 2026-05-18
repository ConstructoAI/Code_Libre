/**
 * ERP React Frontend - Contacts Page
 * List all contacts across companies with search, stats, and create/edit.
 * Matches Streamlit "Gestion des Contacts" form.
 * Mobile-first responsive layout.
 */

import { useEffect, useState, useCallback } from 'react';
import { Users, Search, Plus, Mail, Phone, X, Building2, Pencil } from 'lucide-react';
import * as companiesApi from '@/api/companies';
import type { Contact, ContactCreate, Company } from '@/api/companies';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import { CommandBar } from '@/components/ui/CommandBar';
import StatCard from '@/components/dashboard/StatCard';
import { formatPhone } from '@/utils/format';
import { useSortable } from '@/hooks/useSortable';
import { useColumnResize } from '@/hooks/useColumnResize';
import { SortableHeader } from '@/components/ui/SortableHeader';

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<ContactCreate>({ companyId: null, prenom: '', nomFamille: '' });
  const [createLoading, setCreateLoading] = useState(false);

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<ContactCreate>>({});
  const [editLoading, setEditLoading] = useState(false);

  // Companies for dropdown
  const [companiesList, setCompaniesList] = useState<Company[]>([]);

  const perPage = 20;

  const fetchContacts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await companiesApi.listContacts({
        page, perPage, search: search || undefined,
      });
      setContacts(res.items);
      setTotal(res.total);
    } catch {
      setError('Erreur lors du chargement');
    } finally {
      setIsLoading(false);
    }
  }, [page, search]);

  const fetchCompanies = useCallback(async () => {
    try {
      const res = await companiesApi.listCompanies({ perPage: 100 });
      setCompaniesList(res.items);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const openCreate = () => {
    setForm({ companyId: null, prenom: '', nomFamille: '' });
    fetchCompanies();
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!form.prenom.trim() || !form.nomFamille.trim()) return;
    setCreateLoading(true);
    try {
      await companiesApi.createContact(form);
      setShowCreate(false);
      setForm({ companyId: null, prenom: '', nomFamille: '' });
      setSuccess('Contact enregistré');
      fetchContacts();
    } catch {
      setError('Erreur lors de la création');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Supprimer ce contact ?')) return;
    try {
      await companiesApi.deleteContact(id);
      fetchContacts();
    } catch {
      setError('Erreur lors de la suppression');
    }
  };

  const openEdit = (c: Contact) => {
    setEditId(c.id);
    setEditForm({
      companyId: c.companyId || null,
      prenom: c.prenom || '',
      nomFamille: c.nomFamille || '',
      email: c.email || '',
      telephone: c.telephone || '',
      mobile: c.mobile || '',
      rolePoste: c.rolePoste || '',
      fonction: c.fonction || '',
      departement: c.departement || '',
      adresse: c.adresse || '',
      ville: c.ville || '',
      province: c.province || '',
      codePostal: c.codePostal || '',
      notes: c.notes || '',
    });
    fetchCompanies();
    setShowEdit(true);
  };

  const handleEdit = async () => {
    if (!editId) return;
    setEditLoading(true);
    try {
      await companiesApi.updateContact(editId, editForm);
      setShowEdit(false);
      setSuccess('Contact modifié');
      fetchContacts();
    } catch {
      setError('Erreur lors de la modification');
    } finally {
      setEditLoading(false);
    }
  };

  const { sortedItems: sortedContacts, sortConfig, requestSort } = useSortable(contacts);
  const { colWidths, startResize, autoFit } = useColumnResize({ prenom: 200, companyNom: 180, rolePoste: 160, email: 220, telephone: 140 });

  const totalPages = Math.ceil(total / perPage);

  // Stats
  const uniqueCompanies = new Set(contacts.filter(c => c.companyId).map(c => c.companyId)).size;
  const withEmail = contacts.filter(c => c.email).length;
  const withPhone = contacts.filter(c => c.telephone).length;

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert type="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Contacts</h2>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Contacts" value={total} icon={<Users size={20} />} color="blue" />
        <StatCard label="Entreprises" value={uniqueCompanies} icon={<Building2 size={20} />} color="purple" />
        <StatCard label="Avec Email" value={withEmail} icon={<Mail size={20} />} color="green" />
        <StatCard label="Avec Tel." value={withPhone} icon={<Phone size={20} />} color="yellow" />
      </div>

      {/* CommandBar — D365 style */}
      <CommandBar
        actions={[
          { label: 'Nouveau Contact', icon: <Plus size={15} />, onClick: openCreate, variant: 'primary' },
        ]}
        right={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Rechercher par nom, email, entreprise, rôle..."
                className="erp-input pl-9 w-full"
              />
            </div>
            {search && (
              <button
                onClick={() => { setSearch(''); setPage(1); }}
                className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 bg-gray-100 dark:bg-gray-800 rounded-lg"
              >
                <X size={12} /> Effacer
              </button>
            )}
          </div>
        }
      />

      {/* Table / Cards */}
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
                    <SortableHeader label="Nom" sortKey="prenom" sortConfig={sortConfig} onSort={requestSort} width={colWidths.prenom} onResizeStart={(e) => startResize(e, 'prenom')} onAutoFit={(e) => autoFit(e, 'prenom')} />
                    <SortableHeader label="Entreprise" sortKey="companyNom" sortConfig={sortConfig} onSort={requestSort} width={colWidths.companyNom} onResizeStart={(e) => startResize(e, 'companyNom')} onAutoFit={(e) => autoFit(e, 'companyNom')} />
                    <SortableHeader label="Rôle/Fonction" sortKey="rolePoste" sortConfig={sortConfig} onSort={requestSort} width={colWidths.rolePoste} onResizeStart={(e) => startResize(e, 'rolePoste')} onAutoFit={(e) => autoFit(e, 'rolePoste')} />
                    <SortableHeader label="Email" sortKey="email" sortConfig={sortConfig} onSort={requestSort} width={colWidths.email} onResizeStart={(e) => startResize(e, 'email')} onAutoFit={(e) => autoFit(e, 'email')} />
                    <SortableHeader label="Téléphone" sortKey="telephone" sortConfig={sortConfig} onSort={requestSort} width={colWidths.telephone} onResizeStart={(e) => startResize(e, 'telephone')} onAutoFit={(e) => autoFit(e, 'telephone')} />
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {sortedContacts.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-seaop-primary-100 dark:bg-seaop-primary-900/30 flex items-center justify-center text-xs font-medium text-seaop-primary-600 shrink-0">
                            {c.prenom?.[0]}{c.nomFamille?.[0]}
                          </div>
                          <div>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {c.prenom} {c.nomFamille}
                            </span>
                            {c.estPrincipal && <Badge color="blue" size="sm" className="ml-1">Principal</Badge>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{c.companyNom || '--'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{c.rolePoste || '--'}</td>
                      <td className="px-4 py-3">
                        {c.email ? (
                          <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                            <Mail size={12} /> {c.email}
                          </span>
                        ) : '--'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                        {c.telephone ? formatPhone(c.telephone) : '--'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEdit(c)}
                            className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
                            title="Modifier"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(c.id)}
                            className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            title="Supprimer"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {contacts.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      Aucun contact enregistré.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {sortedContacts.map((c) => (
              <div key={c.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-full bg-seaop-primary-100 dark:bg-seaop-primary-900/30 flex items-center justify-center text-xs font-medium text-seaop-primary-600 shrink-0">
                    {c.prenom?.[0]}{c.nomFamille?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {c.prenom} {c.nomFamille}
                      </span>
                      {c.estPrincipal && <Badge color="blue" size="sm">Principal</Badge>}
                    </div>
                    {c.rolePoste && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">{c.rolePoste}</span>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(c)}
                      className="p-1.5 rounded text-gray-400 hover:text-seaop-primary-600 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20"
                      title="Modifier"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Supprimer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 pl-12">
                  {c.companyNom && (
                    <span className="flex items-center gap-1"><Building2 size={11} /> {c.companyNom}</span>
                  )}
                  {c.email && (
                    <span className="flex items-center gap-1 truncate"><Mail size={11} /> {c.email}</span>
                  )}
                  {c.telephone && (
                    <span className="flex items-center gap-1"><Phone size={11} /> {formatPhone(c.telephone)}</span>
                  )}
                </div>
              </div>
            ))}
            {contacts.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">Aucun contact enregistré.</p>
            )}
          </div>

          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          )}
        </>
      )}

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Nouveau Contact" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Prénom *" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} required />
            <Input label="Nom de famille *" value={form.nomFamille} onChange={(e) => setForm({ ...form, nomFamille: e.target.value })} required />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label="Email" type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input label="Téléphone" value={form.telephone || ''} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Entreprise"
              options={[
                { value: '', label: '-- Sélectionner --' },
                ...companiesList.map((c) => ({ value: String(c.id), label: c.nom })),
              ]}
              value={form.companyId ? String(form.companyId) : ''}
              onChange={(e) => setForm({ ...form, companyId: parseInt(e.target.value) || null })}
            />
            <Input label="Rôle/Fonction" value={form.rolePoste || ''} onChange={(e) => setForm({ ...form, rolePoste: e.target.value })} />
          </div>
          <Input label="Mobile" value={form.mobile || ''} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          <Input label="Adresse" value={form.adresse || ''} onChange={(e) => setForm({ ...form, adresse: e.target.value })} placeholder="123 rue Exemple" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input label="Ville" value={form.ville || ''} onChange={(e) => setForm({ ...form, ville: e.target.value })} />
            <Input label="Province" value={form.province || ''} onChange={(e) => setForm({ ...form, province: e.target.value })} placeholder="QC" />
            <Input label="Code postal" value={form.codePostal || ''} onChange={(e) => setForm({ ...form, codePostal: e.target.value })} placeholder="H0H 0H0" />
          </div>
          <Textarea label="Notes" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
          <p className="text-xs text-gray-400">* Champs obligatoires</p>
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)} className="w-full sm:w-auto">Annuler</Button>
            <Button onClick={handleCreate} isLoading={createLoading} disabled={!form.prenom.trim() || !form.nomFamille.trim()} className="w-full sm:w-auto">
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Contact Modal */}
      <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Modifier le contact" size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Prénom *" value={editForm.prenom || ''} onChange={(e) => setEditForm({ ...editForm, prenom: e.target.value })} required />
            <Input label="Nom *" value={editForm.nomFamille || ''} onChange={(e) => setEditForm({ ...editForm, nomFamille: e.target.value })} required />
          </div>
          <Select label="Entreprise" options={[
            { value: '', label: '-- Sélectionner --' },
            ...companiesList.map(c => ({ value: String(c.id), label: c.nom })),
          ]} value={editForm.companyId ? String(editForm.companyId) : ''} onChange={(e) => setEditForm({ ...editForm, companyId: parseInt(e.target.value) || null })} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Rôle / Poste" value={editForm.rolePoste || ''} onChange={(e) => setEditForm({ ...editForm, rolePoste: e.target.value })} />
            <Input label="Fonction" value={editForm.fonction || ''} onChange={(e) => setEditForm({ ...editForm, fonction: e.target.value })} />
          </div>
          <Input label="Département" value={editForm.departement || ''} onChange={(e) => setEditForm({ ...editForm, departement: e.target.value })} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Email" type="email" value={editForm.email || ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            <Input label="Téléphone" value={editForm.telephone || ''} onChange={(e) => setEditForm({ ...editForm, telephone: e.target.value })} />
          </div>
          <Input label="Mobile" value={editForm.mobile || ''} onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })} />
          <Input label="Adresse" value={editForm.adresse || ''} onChange={(e) => setEditForm({ ...editForm, adresse: e.target.value })} placeholder="123 rue Exemple" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Ville" value={editForm.ville || ''} onChange={(e) => setEditForm({ ...editForm, ville: e.target.value })} />
            <Input label="Province" value={editForm.province || ''} onChange={(e) => setEditForm({ ...editForm, province: e.target.value })} placeholder="QC" />
            <Input label="Code postal" value={editForm.codePostal || ''} onChange={(e) => setEditForm({ ...editForm, codePostal: e.target.value })} placeholder="H0H 0H0" />
          </div>
          <Textarea label="Notes" value={editForm.notes || ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3} />
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowEdit(false)} className="w-full sm:w-auto">Annuler</Button>
            <Button onClick={handleEdit} isLoading={editLoading} disabled={!editForm.prenom?.trim() || !editForm.nomFamille?.trim()} className="w-full sm:w-auto">
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
