/**
 * ClientInfoCard — Fiche client / Informations du devis
 * Composant collapsible reutilise par les 3 onglets creation de devis
 * (Estimation IA, Metre, Manuel) pour une UX coherente.
 */
import { useState } from 'react';
import { FileUp, ChevronDown, ChevronUp } from 'lucide-react';
import type { Company, Contact } from '../../api/companies';
import type { ClientInfo } from './EstimationIA';

interface ClientInfoCardProps {
  clientForm: ClientInfo;
  onChange: (next: ClientInfo) => void;
  companies: Company[];
  contacts: Contact[];
  /** Uncontrolled initial state. Ignored when `open`/`onOpenChange` are provided. */
  defaultOpen?: boolean;
  /** Controlled open state. When set, the caller owns the collapsed/expanded state. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

export default function ClientInfoCard({
  clientForm,
  onChange,
  companies,
  contacts,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
}: ClientInfoCardProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const filteredContacts = clientForm.clientCompanyId
    ? contacts.filter(c => c.companyId === clientForm.clientCompanyId)
    : contacts;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <FileUp size={15} className="text-blue-500" />
          Fiche client / Informations du devis
        </span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 pt-4 space-y-5">
          {/* Section: Projet */}
          <div>
            <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Projet</h4>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Nom du projet</label>
              <input
                type="text"
                className="erp-input w-full text-sm"
                placeholder="Nom du projet..."
                value={clientForm.nomProjet}
                onChange={e => onChange({ ...clientForm, nomProjet: e.target.value })}
              />
            </div>
          </div>

          {/* Section: Client */}
          <div>
            <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Client</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Client Entreprise</label>
                <select
                  className="erp-input w-full text-sm"
                  value={clientForm.clientCompanyId ?? ''}
                  onChange={e => {
                    const v = e.target.value ? Number(e.target.value) : undefined;
                    onChange({ ...clientForm, clientCompanyId: v, clientContactId: undefined });
                  }}
                >
                  <option value="">-- Aucune --</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Client Personne</label>
                <select
                  className="erp-input w-full text-sm"
                  value={clientForm.clientContactId ?? ''}
                  onChange={e => onChange({ ...clientForm, clientContactId: e.target.value ? Number(e.target.value) : undefined })}
                >
                  <option value="">-- Aucun --</option>
                  {filteredContacts.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.prenom} {c.nomFamille}{c.companyNom ? ` (${c.companyNom})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {!clientForm.clientCompanyId && (
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Saisie manuelle (nom client)</label>
                  <input
                    type="text"
                    className="erp-input w-full text-sm"
                    placeholder="Nom du client..."
                    value={clientForm.clientNomDirect ?? ''}
                    onChange={e => onChange({ ...clientForm, clientNomDirect: e.target.value })}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Section: Echeancier */}
          <div>
            <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Échéancier</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date limite soumission</label>
                <input
                  type="date"
                  className="erp-input w-full text-sm"
                  value={clientForm.dateSoumis ?? ''}
                  onChange={e => onChange({ ...clientForm, dateSoumis: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Début prévu travaux</label>
                <input
                  type="date"
                  className="erp-input w-full text-sm"
                  value={clientForm.datePrevu ?? ''}
                  onChange={e => onChange({ ...clientForm, datePrevu: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Section: References */}
          <div>
            <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Références</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">No. PO Client</label>
                <input
                  type="text"
                  className="erp-input w-full text-sm"
                  placeholder="PO-..."
                  value={clientForm.poClient ?? ''}
                  onChange={e => onChange({ ...clientForm, poClient: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Priorité</label>
                <select
                  className="erp-input w-full text-sm"
                  value={clientForm.priorite ?? 'NORMAL'}
                  onChange={e => onChange({ ...clientForm, priorite: e.target.value })}
                >
                  <option value="NORMAL">Normal</option>
                  <option value="HAUTE">Haute</option>
                  <option value="URGENTE">Urgente</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section: Notes */}
          <div>
            <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Notes</h4>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
              <textarea
                className="erp-input w-full text-sm resize-none"
                rows={3}
                placeholder="Notes ou description..."
                value={clientForm.description ?? ''}
                onChange={e => onChange({ ...clientForm, description: e.target.value })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
